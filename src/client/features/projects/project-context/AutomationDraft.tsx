import { ArticleDeliveryActions } from "./ArticleDeliveryActions";
import { DraftFeedbackForm } from "./DraftFeedbackForm";
import { BlockedDraftReview } from "./BlockedDraftReview";
import { FeaturedImagePanel } from "./FeaturedImagePanel";
import { UnknownRevisionRecovery } from "./UnknownRevisionRecovery";
import { ArticleResearchGaps } from "./ArticleResearchGaps";
import {
  ArticleFeedbackHistory,
  RevisionPendingNotice,
} from "./ArticleFeedbackHistory";
import { ArticlePassageReview } from "./ArticlePassageReview";
import { useState } from "react";
import type { ContentFeedback } from "@/types/schemas/contentFeedback";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { getStandardErrorMessage } from "@/client/lib/error-messages";
import {
  decideAutomationDraft,
  getAutomationDraft,
  exportAutomationDraft,
} from "@/serverFunctions/automation";
export function Draft({
  projectId,
  jobId,
  onChanged,
}: {
  projectId: string;
  jobId: string;
  onChanged: () => Promise<unknown>;
}) {
  const [feedback, setFeedback] = useState<ContentFeedback>({
    message: "",
    scope: "article",
    category: "voice",
    instruction: "",
  });
  const client = useQueryClient(),
    key = ["automation-draft", projectId, jobId];
  const query = useQuery({
    queryKey: key,
    queryFn: () => getAutomationDraft({ data: { projectId, jobId } }),
    refetchInterval: (draftQuery) =>
      draftQuery.state.data?.imageAttempts?.some(
        (attempt) => attempt.status === "generating",
      ) ||
      ["revision_queued", "revising", "running", "preparing"].includes(
        draftQuery.state.data?.state ?? "",
      )
        ? 5000
        : false,
    refetchOnWindowFocus: false,
  });
  const decide = useMutation({
    mutationFn: (decision: "approved" | "changes_requested") =>
      decideAutomationDraft({
        data: {
          projectId,
          jobId,
          version: query.data!.version,
          featuredImageId: query.data!.featuredImageId,
          decision,
          feedback: decision === "changes_requested" ? feedback : undefined,
        },
      }),
    onSuccess: () => {
      setFeedback({
        message: "",
        scope: "article",
        category: "voice",
        instruction: "",
      });
      void client.invalidateQueries({ queryKey: key });
      void onChanged();
    },
    onError: (error) =>
      toast.error(
        getStandardErrorMessage(
          error,
          "Draft or Context changed. Refresh before reviewing.",
        ),
      ),
  });
  const copy = useMutation({
    mutationFn: async () => {
      const result = await exportAutomationDraft({
        data: { projectId, jobId },
      });
      await navigator.clipboard.writeText(result.bodyHtml);
    },
    onSuccess: () =>
      toast.success(
        "Clean HTML copied. Paste into a WordPress Custom HTML block or code editor.",
      ),
    onError: (error) =>
      toast.error(
        getStandardErrorMessage(
          error,
          "Could not copy this draft. Its approval or Context may have changed.",
        ),
      ),
  });
  if (query.isPending) return <p role="status">Loading article…</p>;
  if (query.isError)
    return (
      <div role="alert">
        <p>Could not load this article.</p>
        <button
          className="btn btn-sm mt-2"
          onClick={() => void query.refetch()}
        >
          Retry loading article
        </button>
      </div>
    );
  if (!query.data) return null;
  const job = query.data;
  const savedFeedback = job.history.feedback.find(
    (item) => item.artifactVersion === job.version,
  );
  const submittedFeedback = !!savedFeedback;
  const canEditSaved =
    job.state === "needs_revision" &&
    job.approvalRole === "agency" &&
    savedFeedback?.role === "agency";
  const canReview =
    !submittedFeedback &&
    ["awaiting_approval", "needs_revision"].includes(job.state) &&
    job.approvalRole === "agency";
  const imageGenerating = job.imageAttempts.some(
    (attempt) => attempt.status === "generating",
  );
  const unsentFeedback =
    canReview &&
    (!!feedback.message.trim() ||
      !!feedback.instruction.trim() ||
      !!feedback.passages?.length);
  return (
    <section
      className="space-y-3 rounded-lg border border-base-300 p-4"
      data-review-dirty={unsentFeedback}
    >
      <h3 className="text-lg font-semibold">{job.title ?? job.topic}</h3>
      <p className="text-sm">
        Current article · version {job.version} ·{" "}
        {job.state.replaceAll("_", " ")}
      </p>
      {submittedFeedback &&
        [
          "needs_revision",
          "revision_queued",
          "revising",
          "outcome_unknown",
        ].includes(job.state) && (
          <RevisionPendingNotice state={job.state} version={job.version} />
        )}
      {!job.contextCurrent && job.state === "awaiting_approval" && (
        <p className="text-sm" role="status">
          Client Context has changed since this draft. Request a revision using
          the current guidance before approving.
        </p>
      )}
      {job.rationale && (
        <p className="text-sm">Why this article: {job.rationale}</p>
      )}
      {job.publishedUrl && (
        <a
          className="link"
          href={job.publishedUrl}
          target="_blank"
          rel="noreferrer"
        >
          View published article
        </a>
      )}
      {job.message && (
        <p className="rounded border border-base-300 p-3 text-sm" role="status">
          {job.message}
        </p>
      )}
      {job.review && (
        <p className="whitespace-pre-wrap text-sm">
          {job.review.startsWith("Manual article recovery ")
            ? "This version was imported after an uncertain automated revision. Its content and sources were checked for this manual recovery; agency approval is still required. The original draft and feedback remain in the history."
            : job.review}
        </p>
      )}
      <ArticleResearchGaps brief={job.researchBrief} />
      <FeaturedImagePanel
        projectId={projectId}
        jobId={jobId}
        version={job.version}
        selectedId={job.featuredImageId}
        state={job.state}
        attempts={job.imageAttempts}
        articleTitle={job.title ?? job.topic}
        onChanged={() => {
          void client.invalidateQueries({ queryKey: key });
          void onChanged();
        }}
      />
      {imageGenerating && (
        <p className="text-sm" role="status">
          Featured image generation is still in progress. Approval will be
          available when it finishes or the stalled attempt is marked
          unresolved.
        </p>
      )}
      {!!job.researchSources.length && (
        <details className="rounded border border-base-300 p-3 text-sm">
          <summary>
            Sources researched for this version ({job.researchSources.length})
          </summary>
          <p className="my-2">
            Retrieved source pages for editorial evaluation. Inclusion here does
            not verify every claim on a page.
          </p>
          <ul className="list-disc pl-5">
            {job.researchSources.map((source) => (
              <li key={source.id}>
                <a
                  className="link"
                  href={source.url}
                  target="_blank"
                  rel="noreferrer"
                >
                  {source.title}
                </a>
              </li>
            ))}
          </ul>
        </details>
      )}
      {job.bodyHtml && canEditSaved && savedFeedback ? (
        <BlockedDraftReview
          key={savedFeedback.editToken ?? savedFeedback.id}
          projectId={projectId}
          jobId={jobId}
          version={job.version}
          html={job.bodyHtml}
          saved={savedFeedback}
          onSaved={() => {
            void client.invalidateQueries({ queryKey: key });
            void onChanged();
          }}
        />
      ) : (
        job.bodyHtml && (
          <ArticlePassageReview
            key={job.version}
            html={job.bodyHtml}
            comments={feedback.passages ?? []}
            disabled={decide.isPending}
            onChange={
              canReview
                ? (passages) => setFeedback({ ...feedback, passages })
                : undefined
            }
          />
        )
      )}
      {job.state === "outcome_unknown" &&
        job.bodyHtml &&
        job.version < 4 &&
        job.approvalRole === "agency" &&
        savedFeedback?.role === "agency" && (
          <UnknownRevisionRecovery
            key={job.version}
            projectId={projectId}
            jobId={jobId}
            version={job.version}
            title={job.title ?? ""}
            metaDescription={job.metaDescription ?? ""}
            onRecovered={() => {
              void client.invalidateQueries({ queryKey: key });
              void onChanged();
            }}
          />
        )}
      {canReview && !!job.bodyHtml && (
        <DraftFeedbackForm
          version={job.version}
          feedback={feedback}
          setFeedback={setFeedback}
          pending={decide.isPending}
          canApprove={
            job.state === "awaiting_approval" &&
            !!job.qualityPassed &&
            job.contextCurrent &&
            !imageGenerating
          }
          onDecision={(decision) => decide.mutate(decision)}
        />
      )}
      {job.state === "ready_for_manual_publication" && (
        <button
          className="btn btn-sm"
          disabled={copy.isPending}
          onClick={() => copy.mutate()}
        >
          Copy clean HTML
        </button>
      )}
      {job.state === "ready_for_manual_publication" && !job.wordpressPostId && (
        <ArticleDeliveryActions
          projectId={projectId}
          jobId={jobId}
          version={job.version}
          manual={!job.wordpressVersion}
          onChanged={() => {
            void client.invalidateQueries({ queryKey: key });
            void onChanged();
          }}
        />
      )}
      <ArticleFeedbackHistory
        history={job.history}
        currentVersion={job.version}
      />
      <p className="text-xs text-base-content/60">
        Approved articles follow the project’s delivery method: manual
        copy/paste or its own connected WordPress site. Revisions use the
        project’s monthly generation allowance, with up to three
        reviewer-requested revisions per article. Each needs a new approval.
      </p>
    </section>
  );
}
