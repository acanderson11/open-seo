import { ArticleDeliveryActions } from "./ArticleDeliveryActions";
import { DraftFeedbackForm } from "./DraftFeedbackForm";
import { BlockedDraftReview } from "./BlockedDraftReview";
import { FeaturedImagePanel } from "./FeaturedImagePanel";
import { ArticleResearchGaps } from "./ArticleResearchGaps";
import { ArticleFeedbackHistory } from "./ArticleFeedbackHistory";
import { DraftNotices } from "./DraftNotices";
import { ArticlePassageReview } from "./ArticlePassageReview";
import { useState } from "react";
import type { ContentFeedback } from "@/types/schemas/contentFeedback";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { getStandardErrorMessage } from "@/client/lib/error-messages";
import {
  decideAutomationDraft,
  getAutomationDraft,
} from "@/serverFunctions/automation";
export function Draft({
  projectId,
  jobId,
  onChanged,
  onStartAgain,
}: {
  projectId: string;
  jobId: string;
  onChanged: () => Promise<unknown>;
  onStartAgain?: (input: { topic: string; targetUrl?: string }) => void;
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
          "This draft changed. Refresh before reviewing.",
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
      <DraftNotices job={job} submittedFeedback={submittedFeedback} />
      {onStartAgain && job.state === "failed" && job.version === 1 && (
        <button
          className="btn btn-sm"
          onClick={() =>
            onStartAgain({
              topic: job.topic,
              targetUrl: job.targetUrl ?? undefined,
            })
          }
        >
          Start again
        </button>
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
      {canReview && !!job.bodyHtml && (
        <DraftFeedbackForm
          version={job.version}
          feedback={feedback}
          setFeedback={setFeedback}
          pending={decide.isPending}
          canApprove={
            job.state === "awaiting_approval" &&
            !!job.qualityPassed &&
            !imageGenerating
          }
          onDecision={(decision) => decide.mutate(decision)}
        />
      )}
      <ArticleDeliveryActions
        projectId={projectId}
        jobId={jobId}
        version={job.version}
        state={job.state}
        sentToWordpress={!!job.wordpressPostId}
        onChanged={() => {
          void client.invalidateQueries({ queryKey: key });
          void onChanged();
        }}
      />
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
