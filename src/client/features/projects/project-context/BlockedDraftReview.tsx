import { MAX_ARTICLE_VERSION } from "@/types/schemas/automation";
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArticlePassageReview } from "./ArticlePassageReview";
import { revisionMessage } from "@/types/schemas/articlePassages";
import type { ContentFeedback } from "@/types/schemas/contentFeedback";
import {
  updatePendingArticleFeedback,
  type getAutomationDraft,
} from "@/serverFunctions/automation";
type SavedFeedback = NonNullable<
  Awaited<ReturnType<typeof getAutomationDraft>>
>["history"]["feedback"][number];
export function BlockedDraftReview({
  projectId,
  jobId,
  version,
  html,
  saved,
  onSaved,
}: {
  projectId: string;
  jobId: string;
  version: number;
  html: string;
  saved: SavedFeedback;
  onSaved: () => void;
}) {
  const [feedback, setFeedback] = useState<ContentFeedback>({
    message: saved.message,
    passages: saved.passages,
    scope: "article",
    category: "voice",
    instruction: "",
  });
  const [dirty, setDirty] = useState(false);
  const length = revisionMessage(feedback.message, feedback.passages).length;
  const save = useMutation({
    mutationFn: (queueRevision: boolean) =>
      updatePendingArticleFeedback({
        data: {
          projectId,
          jobId,
          version,
          feedbackId: saved.id,
          expectedToken: saved.editToken,
          feedback,
          queueRevision,
        },
      }),
    onSuccess: (result) => {
      setDirty(false);
      toast.success(
        result.queued
          ? "Revision queued using your saved feedback."
          : "Feedback updated. Use Revise using feedback when ready.",
      );
      onSaved();
    },
  });
  return (
    <div className="space-y-4" data-review-dirty={dirty}>
      <ArticlePassageReview
        html={html}
        comments={feedback.passages ?? []}
        disabled={save.isPending}
        saveHint="Save your comments below, or choose Revise using feedback. Research questions are optional."
        onChange={(passages) => {
          setFeedback({ ...feedback, passages });
          setDirty(true);
        }}
      />
      <section
        className="space-y-3 rounded border border-base-300 p-4"
        aria-label="Edit saved feedback"
      >
        <h4 className="font-semibold">
          Edit saved feedback for version {version}
        </h4>
        <p className="text-sm">
          Your earlier feedback is loaded below. Add to it or revise it,
          including answers to the research questions. These edits apply to this
          article; existing standing guidelines stay unchanged.
        </p>
        <label className="block text-sm">
          Overall feedback, answers, or source URLs
          <textarea
            className="textarea textarea-bordered mt-1 w-full"
            rows={6}
            maxLength={4000}
            disabled={save.isPending}
            value={feedback.message}
            onChange={(e) => {
              setFeedback({ ...feedback, message: e.target.value });
              setDirty(true);
            }}
          />
        </label>
        <p
          className={
            length > 4000
              ? "text-sm text-error"
              : "text-xs text-base-content/70"
          }
        >
          {length}/4,000 characters including passage quotes
        </p>
        {save.isError && (
          <p role="alert" className="text-sm text-error">
            Could not save. The draft or its feedback may have changed
            elsewhere. Copy your edits before refreshing, then try again.
          </p>
        )}
        <button
          className="btn btn-sm btn-primary"
          disabled={save.isPending || !dirty || length > 4000 || !length}
          onClick={() => save.mutate(false)}
        >
          {save.isPending ? "Saving…" : "Update saved feedback"}
        </button>
        <button
          className="btn btn-sm btn-primary ml-2"
          disabled={
            save.isPending ||
            length > 4000 ||
            !length ||
            version >= MAX_ARTICLE_VERSION
          }
          onClick={() => save.mutate(true)}
        >
          Revise using feedback
        </button>
        {version >= MAX_ARTICLE_VERSION && (
          <p className="text-sm">
            This article has reached its three-revision limit.
          </p>
        )}
      </section>
    </div>
  );
}
