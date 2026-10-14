import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  changeAutomationArticle,
  exportAutomationDraft,
} from "@/serverFunctions/automation";
import { getStandardErrorMessage } from "@/client/lib/error-messages";

const manualStates = ["ready_for_manual_publication", "publication_blocked"];

export function ArticleDeliveryActions({
  projectId,
  jobId,
  version,
  state,
  sentToWordpress,
  onChanged,
}: {
  projectId: string;
  jobId: string;
  version: number;
  state: string;
  sentToWordpress: boolean;
  onChanged: () => void;
}) {
  const [url, setUrl] = useState("");
  const mutation = useMutation({
    mutationFn: (action: "reopen" | "published") =>
      changeAutomationArticle({
        data: {
          projectId,
          jobId,
          version,
          action,
          ...(action === "published" ? { publishedUrl: url } : {}),
        },
      }),
    onSuccess: () => {
      toast.success("Article status updated.");
      onChanged();
    },
    onError: (error) =>
      toast.error(
        getStandardErrorMessage(error, "Could not update article status."),
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
        getStandardErrorMessage(error, "Could not copy this article."),
      ),
  });
  const manual = manualStates.includes(state) && !sentToWordpress;
  const queued = state === "ready_to_publish";
  if (!manual && !queued) return null;
  return (
    <section
      className="space-y-3 rounded border border-base-300 p-3"
      aria-label="Article delivery"
    >
      {queued && (
        <p className="text-sm">
          Approved for WordPress. It publishes on the next scheduler check,
          within about five minutes.
        </p>
      )}
      {manual && (
        <button
          className="btn btn-sm"
          disabled={copy.isPending}
          onClick={() => copy.mutate()}
        >
          Copy clean HTML
        </button>
      )}
      <button
        className="btn btn-sm"
        disabled={mutation.isPending}
        onClick={() => mutation.mutate("reopen")}
      >
        Return to draft
      </button>
      <p className="text-sm text-base-content/70">
        Returning to draft withdraws approval. You can give feedback and approve
        again before publishing.
      </p>
      {manual && (
        <form
          className="space-y-2"
          onSubmit={(event) => {
            event.preventDefault();
            mutation.mutate("published");
          }}
        >
          <p className="text-sm">
            After you paste and publish the article on your website, enter its
            live URL to move this task to Done. Copying alone leaves it in
            Ready.
          </p>
          <label className="block text-sm">
            Published article URL
            <input
              className="input input-bordered mt-1 w-full bg-base-100"
              type="url"
              required
              maxLength={1000}
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              placeholder="https://your-site.com/article/"
            />
          </label>
          <button
            className="btn btn-primary btn-sm"
            type="submit"
            disabled={mutation.isPending || !url.trim()}
          >
            Mark as published
          </button>
        </form>
      )}
    </section>
  );
}
