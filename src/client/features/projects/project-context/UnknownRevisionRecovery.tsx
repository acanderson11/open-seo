import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { getStandardErrorMessage } from "@/client/lib/error-messages";
import { recoverUnknownAutomationArticle } from "@/serverFunctions/automation";

export function UnknownRevisionRecovery({
  projectId,
  jobId,
  version,
  title: originalTitle,
  metaDescription: originalMeta,
  onRecovered,
}: {
  projectId: string;
  jobId: string;
  version: number;
  title: string;
  metaDescription: string;
  onRecovered: () => void;
}) {
  const [title, setTitle] = useState(originalTitle);
  const [metaDescription, setMetaDescription] = useState(originalMeta);
  const [bodyHtml, setBodyHtml] = useState("");
  const [executionsStopped, setExecutionsStopped] = useState(false);
  const [contentAndSourcesChecked, setContentAndSourcesChecked] =
    useState(false);
  const recover = useMutation({
    mutationFn: () =>
      recoverUnknownAutomationArticle({
        data: {
          projectId,
          jobId,
          version,
          title,
          metaDescription,
          bodyHtml,
          executionsStopped: true,
          contentAndSourcesChecked: true,
        },
      }),
    onSuccess: () => {
      toast.success("Replacement saved as a new draft for agency review.");
      onRecovered();
    },
    onError: (error) =>
      toast.error(
        getStandardErrorMessage(
          error,
          "Recovery could not be saved. The draft, project context, or held slot may have changed.",
        ),
      ),
  });
  return (
    <section
      className="space-y-3 rounded border border-warning/60 p-4"
      aria-label="Recover blocked revision"
    >
      <h4 className="font-semibold">Recover this blocked revision</h4>
      <p className="text-sm">
        The automated revision outcome could not be verified. Import a corrected
        article as a new version. The original draft and feedback stay in the
        history, and the replacement still needs a separate agency approval. The
        uncertain generation attempt remains charged.
      </p>
      <label className="block text-sm">
        Article title
        <input
          className="input input-bordered mt-1 w-full"
          value={title}
          maxLength={180}
          disabled={recover.isPending}
          onChange={(event) => setTitle(event.target.value)}
        />
      </label>
      <label className="block text-sm">
        Meta description
        <textarea
          className="textarea textarea-bordered mt-1 w-full"
          rows={2}
          value={metaDescription}
          maxLength={320}
          disabled={recover.isPending}
          onChange={(event) => setMetaDescription(event.target.value)}
        />
      </label>
      <label className="block text-sm">
        Corrected article HTML
        <textarea
          className="textarea textarea-bordered mt-1 w-full font-mono text-xs"
          rows={15}
          value={bodyHtml}
          maxLength={50000}
          disabled={recover.isPending}
          onChange={(event) => setBodyHtml(event.target.value)}
          placeholder="Paste article HTML with headings, paragraphs, lists, emphasis, and HTTPS links."
        />
      </label>
      <p className="text-xs text-base-content/70">
        Only article headings, paragraphs, lists, emphasis, and HTTPS links are
        accepted. Scripts and embedded media are rejected.
      </p>
      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          className="checkbox checkbox-sm"
          checked={executionsStopped}
          disabled={recover.isPending}
          onChange={(event) => setExecutionsStopped(event.target.checked)}
        />
        <span>
          I checked the external workflow and confirmed no execution is still
          running, waiting, or queued for this revision.
        </span>
      </label>
      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          className="checkbox checkbox-sm"
          checked={contentAndSourcesChecked}
          disabled={recover.isPending}
          onChange={(event) =>
            setContentAndSourcesChecked(event.target.checked)
          }
        />
        <span>
          I checked the replacement’s content, claims, and source links. This
          records an editorial check, not an automated quality result or final
          approval.
        </span>
      </label>
      <button
        className="btn btn-sm btn-primary"
        disabled={
          recover.isPending ||
          !executionsStopped ||
          !contentAndSourcesChecked ||
          title.trim().length < 10 ||
          metaDescription.trim().length < 30 ||
          bodyHtml.trim().length < 400
        }
        onClick={() => recover.mutate()}
      >
        {recover.isPending
          ? "Saving replacement…"
          : "Save replacement for review"}
      </button>
    </section>
  );
}
