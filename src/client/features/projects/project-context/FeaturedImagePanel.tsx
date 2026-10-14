import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { getStandardErrorMessage } from "@/client/lib/error-messages";
import {
  abandonArticleFeaturedAttempt,
  generateArticleFeaturedImage,
  getArticleFeaturedImage,
  replaceArticleFeaturedImage,
  updateArticleFeaturedAlt,
  getPreviousArticleFeaturedImages,
  reuseArticleFeaturedImage,
} from "@/serverFunctions/featuredImages";

type Attempt = {
  id: string;
  status: string;
  createdAt: string;
  failure: string | null;
};

export type FeaturedImagePanelProps = {
  projectId: string;
  jobId: string;
  version: number;
  selectedId: string | null;
  state: string;
  attempts: Attempt[];
  articleTitle?: string;
  onChanged: () => void;
};

async function readImage(file: File) {
  if (
    !["image/jpeg", "image/png", "image/webp"].includes(file.type) ||
    file.size > 12_000_000
  )
    throw new Error("Choose a JPEG, PNG, or WebP image under 12 MB.");
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () =>
      reject(new Error("Could not read the selected image."));
    reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
    reader.readAsDataURL(file);
  });
}

export function FeaturedImagePanel({
  projectId,
  jobId,
  version,
  selectedId,
  state,
  attempts,
  articleTitle,
  onChanged,
}: FeaturedImagePanelProps) {
  const client = useQueryClient();
  const imageKey = ["article-featured-image", projectId, jobId, selectedId];
  const imageQuery = useQuery({
    queryKey: imageKey,
    queryFn: () => getArticleFeaturedImage({ data: { projectId, jobId } }),
    enabled: !!selectedId,
  });
  const [visualBrief, setVisualBrief] = useState("");
  const [feedback, setFeedback] = useState("");
  const [remember, setRemember] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [fileInputVersion, setFileInputVersion] = useState(0);
  const [source, setSource] = useState<"client" | "stock">("client");
  const [sourceUrl, setSourceUrl] = useState("");
  const [rightsNote, setRightsNote] = useState("");
  const [replacementAlt, setReplacementAlt] = useState("");
  const [savedAlt, setSavedAlt] = useState("");
  const [confirmedStopped, setConfirmedStopped] = useState(false);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    setSavedAlt(imageQuery.data?.image?.altText ?? "");
  }, [imageQuery.data?.image?.id, imageQuery.data?.image?.altText]);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 15_000);
    return () => window.clearInterval(timer);
  }, []);

  const editable = [
    "awaiting_approval",
    "needs_revision",
    "ready_for_manual_publication",
  ].includes(state);
  const previousImages = useQuery({
    queryKey: ["previous-article-images", projectId, jobId, version],
    queryFn: () =>
      getPreviousArticleFeaturedImages({ data: { projectId, jobId, version } }),
    enabled: editable && version > 1,
  });
  const pending = attempts.find((attempt) => attempt.status === "generating");
  const stalled = !!pending && now - Date.parse(pending.createdAt) > 2 * 60_000;
  const latestFailure = attempts.find((attempt) => attempt.status === "failed");
  const image = imageQuery.data;
  const selectedImage = image?.image;

  useEffect(() => {
    if (!pending) return;
    const timer = window.setInterval(() => {
      void client.invalidateQueries({
        queryKey: ["automation-draft", projectId, jobId],
      });
    }, 5000);
    return () => window.clearInterval(timer);
  }, [client, projectId, jobId, pending?.id]);

  function refresh() {
    void Promise.all([
      client.invalidateQueries({
        queryKey: ["article-featured-image", projectId, jobId],
      }),
      client.invalidateQueries({
        queryKey: ["automation-draft", projectId, jobId],
      }),
      client.invalidateQueries({ queryKey: ["execution-board", projectId] }),
      client.invalidateQueries({ queryKey: ["automation", projectId] }),
    ]);
    onChanged();
  }

  const generate = useMutation({
    mutationFn: () =>
      generateArticleFeaturedImage({
        data: {
          projectId,
          jobId,
          version,
          visualBrief,
          feedback,
          rememberFeedback: remember,
        },
      }),
    onSuccess: (result) => {
      toast[result?.status === "ready" ? "success" : "error"](
        result?.status === "ready"
          ? "Featured image ready for review."
          : "Image generation did not complete. You can upload an approved image or try again.",
      );
      refresh();
    },
    onError: (error) =>
      toast.error(
        getStandardErrorMessage(
          error,
          "Could not start image generation. Refresh the article and try again.",
        ),
      ),
  });
  const reuse = useMutation({
    mutationFn: (sourceImageId: string) =>
      reuseArticleFeaturedImage({
        data: { projectId, jobId, version, sourceImageId },
      }),
    onSuccess: () => {
      toast.success(
        "Previous image restored. Review it with this article before approval.",
      );
      refresh();
    },
    onError: (error) =>
      toast.error(
        getStandardErrorMessage(
          error,
          "Could not restore the previous image. Refresh and try again.",
        ),
      ),
  });
  const replace = useMutation({
    mutationFn: async () => {
      if (!file) throw new Error("Choose an image to upload.");
      return replaceArticleFeaturedImage({
        data: {
          projectId,
          jobId,
          version,
          filename: file.name,
          imageBase64: await readImage(file),
          source,
          sourceUrl: sourceUrl.trim() || undefined,
          rightsNote,
          altText: replacementAlt,
          visualBrief,
        },
      });
    },
    onSuccess: () => {
      toast.success(
        "Image replaced. The article and image need review together before approval.",
      );
      setFile(null);
      setFileInputVersion((value) => value + 1);
      setReplacementAlt("");
      refresh();
    },
    onError: (error) =>
      toast.error(
        getStandardErrorMessage(
          error,
          "Could not replace the image. Check its size and source details.",
        ),
      ),
  });
  const saveAlt = useMutation({
    mutationFn: () =>
      updateArticleFeaturedAlt({
        data: {
          projectId,
          jobId,
          version,
          imageId: selectedId!,
          altText: savedAlt,
        },
      }),
    onSuccess: () => {
      toast.success(
        "Alt text saved. The article needs review again before approval.",
      );
      refresh();
    },
    onError: (error) =>
      toast.error(getStandardErrorMessage(error, "Could not save alt text.")),
  });
  const abandon = useMutation({
    mutationFn: (attemptId: string) =>
      abandonArticleFeaturedAttempt({
        data: {
          projectId,
          jobId,
          version,
          attemptId,
          confirmedStopped: true,
        },
      }),
    onSuccess: () => {
      toast.success(
        "Stalled attempt marked unresolved. You can choose another image.",
      );
      setConfirmedStopped(false);
      refresh();
    },
    onError: (error) =>
      toast.error(
        getStandardErrorMessage(
          error,
          "The attempt is still active or has changed.",
        ),
      ),
  });

  const mutationBusy =
    generate.isPending ||
    reuse.isPending ||
    replace.isPending ||
    saveAlt.isPending ||
    abandon.isPending;
  const titleSlug = articleTitle
    ?.normalize("NFKD")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase()
    .slice(0, 80);
  const downloadName = `${titleSlug || `article-${jobId.slice(0, 8)}`}-featured-v${version}.webp`;
  return (
    <section
      className="space-y-4 rounded border border-base-300 p-4"
      aria-label="Featured image review"
    >
      <div className="space-y-1">
        <h4 className="font-semibold">Featured image</h4>
        <p className="text-sm text-base-content/70">
          Review this image with article version {version}. The saved file is a
          1280 × 720 WebP.
        </p>
      </div>

      {selectedId && imageQuery.isPending && (
        <p role="status" className="text-sm">
          Loading featured image…
        </p>
      )}
      {selectedId && imageQuery.isError && (
        <p role="alert" className="text-sm text-error">
          Could not load the saved image. Refresh or upload a replacement.
        </p>
      )}
      {image?.base64 && selectedImage && (
        <figure className="max-w-xl space-y-2">
          <div className="aspect-video w-full overflow-hidden rounded bg-base-200">
            <img
              className="h-full w-full object-contain"
              src={`data:image/webp;base64,${image.base64}`}
              alt={
                selectedImage.altText ||
                "Featured image awaiting an alt description"
              }
            />
          </div>
          <figcaption className="text-xs text-base-content/70">
            {selectedImage.source === "generated"
              ? "Generated"
              : selectedImage.source === "stock"
                ? "Licensed stock"
                : "Client supplied"}
            {selectedImage.bytes != null &&
              ` · ${(selectedImage.bytes / 1000).toFixed(0)} KB`}
            {selectedImage.model && ` · ${selectedImage.model}`}
          </figcaption>
          <p className="text-sm">
            <span className="font-medium">Alt text:</span>{" "}
            {selectedImage.altText || "No alt description saved yet."}
          </p>
          <a
            className="btn btn-sm btn-outline"
            href={`data:image/webp;base64,${image.base64}`}
            download={downloadName}
          >
            Download WebP
          </a>
          {editable && (
            <details className="text-sm">
              <summary className="cursor-pointer font-medium">
                Edit alt text
              </summary>
              <div className="space-y-2 pt-3">
                <label className="block">
                  Describe what is actually shown
                  <input
                    className="input input-bordered mt-1 w-full"
                    maxLength={300}
                    value={savedAlt}
                    onChange={(event) => setSavedAlt(event.target.value)}
                  />
                </label>
                <button
                  type="button"
                  className="btn btn-sm"
                  disabled={
                    mutationBusy ||
                    !!pending ||
                    savedAlt.trim().length < 15 ||
                    savedAlt.trim() === selectedImage.altText
                  }
                  onClick={() => saveAlt.mutate()}
                >
                  {saveAlt.isPending ? "Saving…" : "Save alt text"}
                </button>
              </div>
            </details>
          )}
        </figure>
      )}
      {!selectedId && (
        <p className="text-sm text-base-content/70">
          No featured image is selected yet. You can still review the article if
          image generation failed.
        </p>
      )}
      {latestFailure &&
        (!selectedImage ||
          Date.parse(latestFailure.createdAt) >
            Date.parse(selectedImage.createdAt)) && (
          <p role="alert" className="text-sm text-warning">
            An image attempt failed
            {latestFailure.failure ? ` (${latestFailure.failure})` : ""}.{" "}
            {selectedImage
              ? "Your current image is still selected."
              : "Use a previous image if available, or upload a replacement."}{" "}
            Start another generation only when you want a new image.
          </p>
        )}
      {pending && (
        <p role="status" className="text-sm">
          Image generation is in progress, or its result is uncertain. Another
          paid attempt is unavailable until this resolves.
        </p>
      )}
      {stalled && editable && (
        <div className="space-y-2 rounded border border-warning/50 p-3">
          <p className="text-sm">
            This attempt has been pending for over two minutes. Check that
            generation has stopped before clearing it; a late result may still
            arrive.
          </p>
          <label className="flex items-start gap-2 text-sm">
            <input
              className="checkbox checkbox-sm mt-0.5"
              type="checkbox"
              checked={confirmedStopped}
              onChange={(event) => setConfirmedStopped(event.target.checked)}
            />
            I confirmed this image attempt has stopped.
          </label>
          <button
            type="button"
            className="btn btn-sm"
            disabled={!confirmedStopped || mutationBusy}
            onClick={() => abandon.mutate(pending.id)}
          >
            Mark attempt unresolved
          </button>
        </div>
      )}

      {editable && (
        <div className="space-y-3 border-t border-base-300 pt-4">
          {!selectedId && !!previousImages.data?.length && (
            <div className="space-y-2">
              <p className="text-sm text-base-content/70">
                A previous version has a saved image. Reuse it without
                generating a new one.
              </p>
              {previousImages.data.map((previous) => (
                <button
                  key={previous.id}
                  type="button"
                  className="btn btn-sm btn-outline"
                  disabled={mutationBusy || !!pending}
                  onClick={() => reuse.mutate(previous.id)}
                  title={previous.altText}
                >
                  {reuse.isPending
                    ? "Restoring image…"
                    : "Use image from version " + previous.version}
                </button>
              ))}
            </div>
          )}
          <button
            type="button"
            className="btn btn-sm btn-primary"
            disabled={mutationBusy || !!pending}
            onClick={() => generate.mutate()}
          >
            {generate.isPending
              ? "Generating image…"
              : selectedId
                ? "Regenerate image"
                : "Generate image"}
          </button>
          <details className="text-sm">
            <summary className="cursor-pointer font-medium">
              Change image
            </summary>
            <div className="space-y-3 pt-3">
              <p className="text-base-content/70">
                These directions apply when you select Generate or Regenerate
                above.
              </p>
              <label className="block">
                Visual brief
                <textarea
                  className="textarea textarea-bordered mt-1 w-full"
                  rows={2}
                  maxLength={600}
                  value={visualBrief}
                  onChange={(event) => setVisualBrief(event.target.value)}
                  placeholder="Describe the scene or concept for this article"
                />
              </label>
              <label className="block">
                Feedback for regeneration
                <textarea
                  className="textarea textarea-bordered mt-1 w-full"
                  rows={2}
                  maxLength={500}
                  value={feedback}
                  onChange={(event) => setFeedback(event.target.value)}
                  placeholder="What should change in the next image?"
                />
              </label>
              <label className="flex items-start gap-2">
                <input
                  className="checkbox checkbox-sm mt-0.5"
                  type="checkbox"
                  checked={remember}
                  onChange={(event) => setRemember(event.target.checked)}
                />
                Remember this feedback for future images in this project
              </label>
            </div>
          </details>

          <details className="text-sm">
            <summary className="cursor-pointer font-medium">
              Upload replacement
            </summary>
            <div className="space-y-3 pt-3">
              <p className="text-xs text-base-content/70">
                JPEG, PNG, or WebP, up to 12 MB. The image is resized to 16:9
                WebP.
              </p>
              <label className="block">
                Image file
                <input
                  key={fileInputVersion}
                  className="file-input file-input-bordered mt-1 w-full"
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  onChange={(event) => setFile(event.target.files?.[0] ?? null)}
                />
              </label>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block">
                  Source
                  <select
                    className="select select-bordered mt-1 w-full"
                    value={source}
                    onChange={(event) =>
                      setSource(
                        event.target.value === "stock" ? "stock" : "client",
                      )
                    }
                  >
                    <option value="client">Client supplied</option>
                    <option value="stock">Licensed stock</option>
                  </select>
                </label>
                <label className="block">
                  Source URL, if applicable
                  <input
                    className="input input-bordered mt-1 w-full"
                    type="url"
                    maxLength={1000}
                    value={sourceUrl}
                    onChange={(event) => setSourceUrl(event.target.value)}
                    placeholder="https://"
                  />
                </label>
              </div>
              <label className="block">
                Rights or license note
                <textarea
                  className="textarea textarea-bordered mt-1 w-full"
                  rows={2}
                  maxLength={1000}
                  value={rightsNote}
                  onChange={(event) => setRightsNote(event.target.value)}
                  placeholder="Who supplied this image, and what use is allowed?"
                />
              </label>
              <label className="block">
                Alt text for the uploaded image
                <input
                  className="input input-bordered mt-1 w-full"
                  maxLength={300}
                  value={replacementAlt}
                  onChange={(event) => setReplacementAlt(event.target.value)}
                  placeholder="Describe what is actually shown"
                />
              </label>
              <button
                type="button"
                className="btn btn-sm"
                disabled={
                  mutationBusy ||
                  !!pending ||
                  !file ||
                  rightsNote.trim().length < 10 ||
                  replacementAlt.trim().length < 15
                }
                onClick={() => replace.mutate()}
              >
                {replace.isPending ? "Uploading…" : "Replace image"}
              </button>
            </div>
          </details>
        </div>
      )}
    </section>
  );
}
