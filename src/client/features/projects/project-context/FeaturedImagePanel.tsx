import { useEffect, useState } from "react";
import {
  useIsMutating,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { toast } from "sonner";
import { getStandardErrorMessage } from "@/client/lib/error-messages";
import {
  generateArticleFeaturedImage,
  getArticleFeaturedImage,
  getPreviousArticleFeaturedImages,
  reuseArticleFeaturedImage,
} from "@/serverFunctions/featuredImages";
import {
  featuredImageMutationKey,
  ReplaceFeaturedImageForm,
  SelectedFeaturedImage,
  StalledImageAttempt,
} from "./FeaturedImageParts";

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
  const [now, setNow] = useState(Date.now());
  const article = { projectId, jobId, version };
  const mutationKey = featuredImageMutationKey(jobId);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 15_000);
    return () => window.clearInterval(timer);
  }, []);

  const editable = [
    "awaiting_approval",
    "needs_revision",
    "ready_for_manual_publication",
    "ready_to_publish",
    "publication_blocked",
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
  const pendingId = pending?.id;
  const selectedImage = imageQuery.data?.image;

  useEffect(() => {
    if (!pendingId) return;
    const timer = window.setInterval(() => {
      void client.invalidateQueries({
        queryKey: ["automation-draft", projectId, jobId],
      });
    }, 5000);
    return () => window.clearInterval(timer);
  }, [client, projectId, jobId, pendingId]);

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
    mutationKey,
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
    mutationKey,
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

  const mutating = useIsMutating({ mutationKey }) > 0;
  // A generating attempt also blocks changes, except clearing a stalled one.
  const busy = mutating || !!pending;
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
      {imageQuery.data && (
        <SelectedFeaturedImage
          article={article}
          saved={imageQuery.data}
          downloadName={downloadName}
          editable={editable}
          busy={busy}
          onChanged={refresh}
        />
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
        <StalledImageAttempt
          article={article}
          attemptId={pending.id}
          busy={mutating}
          onChanged={refresh}
        />
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
                  disabled={busy}
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
            disabled={busy}
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

          <ReplaceFeaturedImageForm
            article={article}
            visualBrief={visualBrief}
            busy={busy}
            onChanged={refresh}
          />
        </div>
      )}
    </section>
  );
}
