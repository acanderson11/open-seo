import type { getAutomationDraft } from "@/serverFunctions/automation";
import { RevisionPendingNotice } from "./ArticleFeedbackHistory";

const pendingRevisionStates = [
  "needs_revision",
  "revision_queued",
  "revising",
  "outcome_unknown",
];

/** Version, status, and the messages a reviewer should see before the article itself. */
export function DraftNotices({
  job,
  submittedFeedback,
}: {
  job: Awaited<ReturnType<typeof getAutomationDraft>>;
  submittedFeedback: boolean;
}) {
  return (
    <>
      <h3 className="text-lg font-semibold">{job.title ?? job.topic}</h3>
      <p className="text-sm">
        Current article · version {job.version} ·{" "}
        {job.state.replaceAll("_", " ")}
      </p>
      {submittedFeedback && pendingRevisionStates.includes(job.state) && (
        <RevisionPendingNotice state={job.state} version={job.version} />
      )}
      {!job.contextCurrent && job.state === "awaiting_approval" && (
        <p className="text-sm" role="status">
          Client Context or writing guidelines changed after this draft was
          written. You can still approve it, or request a revision to apply the
          current guidance.
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
    </>
  );
}
