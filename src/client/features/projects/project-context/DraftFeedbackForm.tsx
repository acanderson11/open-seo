import type { ContentFeedback } from "@/types/schemas/contentFeedback";
import { revisionMessage } from "@/types/schemas/articlePassages";
export function DraftFeedbackForm({
  version,
  feedback,
  setFeedback,
  pending,
  canApprove,
  onDecision,
}: {
  version: number;
  feedback: ContentFeedback;
  setFeedback: (feedback: ContentFeedback) => void;
  pending: boolean;
  canApprove: boolean;
  onDecision: (decision: "approved" | "changes_requested") => void;
}) {
  const feedbackLength = revisionMessage(
    feedback.message,
    feedback.passages,
  ).length;
  const hasFeedback = !!feedback.message.trim() || !!feedback.passages?.length;
  return (
    <div className="space-y-3 border-t border-base-300 pt-4">
      <h4 className="font-semibold">Review version {version}</h4>
      <label className="block text-sm">
        Overall feedback (optional)
        <textarea
          className="textarea textarea-bordered mt-1 w-full"
          maxLength={4000}
          rows={4}
          value={feedback.message}
          onChange={(event) =>
            setFeedback({ ...feedback, message: event.target.value })
          }
          placeholder="Use this for changes that apply to the whole article."
        />
      </label>
      <label className="block text-sm">
        How should we use this feedback?
        <select
          className="select select-bordered mt-1 w-full"
          value={feedback.scope}
          onChange={(event) =>
            setFeedback({
              ...feedback,
              scope:
                event.target.value === "preference"
                  ? "preference"
                  : event.target.value === "fact"
                    ? "fact"
                    : "article",
            })
          }
        >
          <option value="article">This article only</option>
          <option value="preference">
            Remember a writing preference for this client
          </option>
          <option value="fact">
            Correct a business fact (requires verification)
          </option>
        </select>
      </label>
      {feedback.scope !== "article" && (
        <div className="space-y-2">
          <label className="block text-sm">
            Lasting instruction or factual correction
            <textarea
              className="textarea textarea-bordered mt-1 w-full"
              maxLength={1000}
              rows={2}
              value={feedback.instruction}
              onChange={(event) =>
                setFeedback({
                  ...feedback,
                  instruction: event.target.value,
                })
              }
              placeholder="Example: Use plain explanations and avoid sports metaphors."
            />
          </label>
          {feedback.scope === "preference" && (
            <label className="block text-sm">
              Preference category
              <select
                className="select select-bordered ml-2"
                value={feedback.category}
                onChange={(event) =>
                  setFeedback({
                    ...feedback,
                    category:
                      event.target.value === "structure"
                        ? "structure"
                        : event.target.value === "terminology"
                          ? "terminology"
                          : "voice",
                  })
                }
              >
                <option value="voice">Voice and tone</option>
                <option value="structure">Article structure</option>
                <option value="terminology">Words and terminology</option>
              </select>
            </label>
          )}
          <p className="text-xs text-base-content/70">
            New writing preferences apply to future drafts. An overlapping
            category or factual correction is held for agency review in Context
            → Learned guidelines.
          </p>
        </div>
      )}
      <p
        className={
          feedbackLength > 4000
            ? "text-sm text-error"
            : "text-xs text-base-content/60"
        }
      >
        {feedback.passages?.length ?? 0} passage comments · {feedbackLength}
        /4,000 characters including quotes
      </p>
      <div className="flex flex-wrap gap-2">
        <button
          className="btn btn-sm btn-primary"
          disabled={
            pending ||
            !canApprove ||
            hasFeedback ||
            feedbackLength > 4000 ||
            !!feedback.instruction.trim()
          }
          onClick={() => onDecision("approved")}
        >
          Approve as agency
        </button>
        <button
          className="btn btn-sm"
          disabled={
            pending ||
            !hasFeedback ||
            feedbackLength > 4000 ||
            (feedback.scope !== "article" && !feedback.instruction.trim())
          }
          onClick={() => onDecision("changes_requested")}
        >
          Save feedback and request revision
        </button>
      </div>
    </div>
  );
}
