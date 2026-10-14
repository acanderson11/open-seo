import { useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { getStandardErrorMessage } from "@/client/lib/error-messages";
import {
  abandonArticleFeaturedAttempt,
  replaceArticleFeaturedImage,
  updateArticleFeaturedAlt,
  type getArticleFeaturedImage,
} from "@/serverFunctions/featuredImages";
import { readImageFile } from "./readImageFile";

type ArticleVersion = { projectId: string; jobId: string; version: number };
type SavedImage = NonNullable<
  Awaited<ReturnType<typeof getArticleFeaturedImage>>
>;

/** Every featured-image mutation for an article shares this key, so any one in flight disables the rest. */
export const featuredImageMutationKey = (jobId: string) => [
  "featured-image",
  jobId,
];

const sourceLabel = (source: string) =>
  source === "generated"
    ? "Generated"
    : source === "stock"
      ? "Licensed stock"
      : "Client supplied";

export function SelectedFeaturedImage({
  article,
  saved,
  downloadName,
  editable,
  busy,
  onChanged,
}: {
  article: ArticleVersion;
  saved: SavedImage;
  downloadName: string;
  editable: boolean;
  busy: boolean;
  onChanged: () => void;
}) {
  const image = saved.image;
  const [altText, setAltText] = useState(image?.altText ?? "");
  useEffect(() => setAltText(image?.altText ?? ""), [image?.altText]);
  const saveAlt = useMutation({
    mutationKey: featuredImageMutationKey(article.jobId),
    mutationFn: (imageId: string) =>
      updateArticleFeaturedAlt({ data: { ...article, imageId, altText } }),
    onSuccess: () => {
      toast.success(
        "Alt text saved. The article needs review again before approval.",
      );
      onChanged();
    },
    onError: (error) =>
      toast.error(getStandardErrorMessage(error, "Could not save alt text.")),
  });
  if (!saved.base64 || !image) return null;
  const src = `data:image/webp;base64,${saved.base64}`;
  return (
    <figure className="max-w-xl space-y-2">
      <div className="aspect-video w-full overflow-hidden rounded bg-base-200">
        <img
          className="h-full w-full object-contain"
          src={src}
          alt={image.altText || "Featured image awaiting an alt description"}
        />
      </div>
      <figcaption className="text-xs text-base-content/70">
        {sourceLabel(image.source)}
        {image.bytes != null && ` · ${(image.bytes / 1000).toFixed(0)} KB`}
        {image.model && ` · ${image.model}`}
      </figcaption>
      <p className="text-sm">
        <span className="font-medium">Alt text:</span>{" "}
        {image.altText || "No alt description saved yet."}
      </p>
      <a className="btn btn-sm btn-outline" href={src} download={downloadName}>
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
                value={altText}
                onChange={(event) => setAltText(event.target.value)}
              />
            </label>
            <button
              type="button"
              className="btn btn-sm"
              disabled={
                busy ||
                altText.trim().length < 15 ||
                altText.trim() === image.altText
              }
              onClick={() => saveAlt.mutate(image.id)}
            >
              {saveAlt.isPending ? "Saving…" : "Save alt text"}
            </button>
          </div>
        </details>
      )}
    </figure>
  );
}

export function ReplaceFeaturedImageForm({
  article,
  visualBrief,
  busy,
  onChanged,
}: {
  article: ArticleVersion;
  visualBrief: string;
  busy: boolean;
  onChanged: () => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [fileInputVersion, setFileInputVersion] = useState(0);
  const [source, setSource] = useState<"client" | "stock">("client");
  const [sourceUrl, setSourceUrl] = useState("");
  const [rightsNote, setRightsNote] = useState("");
  const [altText, setAltText] = useState("");
  const replace = useMutation({
    mutationKey: featuredImageMutationKey(article.jobId),
    mutationFn: async (upload: File) =>
      replaceArticleFeaturedImage({
        data: {
          ...article,
          filename: upload.name,
          imageBase64: await readImageFile(upload),
          source,
          sourceUrl: sourceUrl.trim() || undefined,
          rightsNote,
          altText,
          visualBrief,
        },
      }),
    onSuccess: () => {
      toast.success(
        "Image replaced. The article and image need review together before approval.",
      );
      setFile(null);
      setFileInputVersion((value) => value + 1);
      setAltText("");
      onChanged();
    },
    onError: (error) =>
      toast.error(
        getStandardErrorMessage(
          error,
          "Could not replace the image. Check its size and source details.",
        ),
      ),
  });
  return (
    <details className="text-sm">
      <summary className="cursor-pointer font-medium">
        Upload replacement
      </summary>
      <div className="space-y-3 pt-3">
        <p className="text-xs text-base-content/70">
          JPEG, PNG, or WebP, up to 12 MB. The image is resized to 16:9 WebP.
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
                setSource(event.target.value === "stock" ? "stock" : "client")
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
            value={altText}
            onChange={(event) => setAltText(event.target.value)}
            placeholder="Describe what is actually shown"
          />
        </label>
        <button
          type="button"
          className="btn btn-sm"
          disabled={
            busy ||
            !file ||
            rightsNote.trim().length < 10 ||
            altText.trim().length < 15
          }
          onClick={() => file && replace.mutate(file)}
        >
          {replace.isPending ? "Uploading…" : "Replace image"}
        </button>
      </div>
    </details>
  );
}

export function StalledImageAttempt({
  article,
  attemptId,
  busy,
  onChanged,
}: {
  article: ArticleVersion;
  attemptId: string;
  busy: boolean;
  onChanged: () => void;
}) {
  const [confirmedStopped, setConfirmedStopped] = useState(false);
  const abandon = useMutation({
    mutationKey: featuredImageMutationKey(article.jobId),
    mutationFn: () =>
      abandonArticleFeaturedAttempt({
        data: { ...article, attemptId, confirmedStopped: true },
      }),
    onSuccess: () => {
      toast.success(
        "Stalled attempt marked unresolved. You can choose another image.",
      );
      setConfirmedStopped(false);
      onChanged();
    },
    onError: (error) =>
      toast.error(
        getStandardErrorMessage(
          error,
          "The attempt is still active or has changed.",
        ),
      ),
  });
  return (
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
        disabled={!confirmedStopped || busy}
        onClick={() => abandon.mutate()}
      >
        Mark attempt unresolved
      </button>
    </div>
  );
}
