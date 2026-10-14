import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { getStandardErrorMessage } from "@/client/lib/error-messages";
import {
  getProjectFeaturedAssetData,
  getProjectImageSettings,
  saveProjectImageSettings,
  uploadProjectFeaturedAsset,
} from "@/serverFunctions/featuredImages";

export type ProjectImageSettingsProps = {
  projectId: string;
  onSaved: () => void;
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

export function ProjectImageSettings({
  projectId,
  onSaved,
}: ProjectImageSettingsProps) {
  const client = useQueryClient();
  const key = ["project-image-settings", projectId];
  const query = useQuery({
    queryKey: key,
    queryFn: () => getProjectImageSettings({ data: { projectId } }),
  });
  const [style, setStyle] = useState("");
  const [autoGenerate, setAutoGenerate] = useState(false);
  const [colors, setColors] = useState("");
  const [reference, setReference] = useState("");
  const [avoid, setAvoid] = useState("");
  const [guidance, setGuidance] = useState("");
  const [preferredAssetId, setPreferredAssetId] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [fileInputVersion, setFileInputVersion] = useState(0);
  const [sourceUrl, setSourceUrl] = useState("");
  const [rightsNote, setRightsNote] = useState("");
  const [altText, setAltText] = useState("");

  useEffect(() => {
    const preference = query.data?.preferences;
    if (!query.data) return;
    setStyle(preference?.style ?? "");
    setAutoGenerate(preference?.autoGenerate === 1);
    setColors(preference?.colors ?? "");
    setReference(preference?.reference ?? "");
    setAvoid(preference?.avoid ?? "");
    setGuidance(preference?.guidance ?? "");
    setPreferredAssetId(preference?.preferredAssetId ?? null);
  }, [query.data?.preferences?.version, query.isSuccess]);

  const asset = query.data?.assets.find((item) => item.id === preferredAssetId);
  const preview = useQuery({
    queryKey: ["project-image-asset", projectId, preferredAssetId],
    queryFn: () =>
      getProjectFeaturedAssetData({
        data: { projectId, assetId: preferredAssetId! },
      }),
    enabled: !!preferredAssetId,
  });

  const save = useMutation({
    mutationFn: () =>
      saveProjectImageSettings({
        data: {
          projectId,
          expectedVersion: query.data?.preferences?.version ?? null,
          autoGenerate,
          style,
          colors,
          reference,
          avoid,
          guidance,
          preferredAssetId,
        },
      }),
    onSuccess: () => {
      toast.success("Image preferences saved.");
      void client.invalidateQueries({ queryKey: key });
      onSaved();
    },
    onError: (error) =>
      toast.error(
        getStandardErrorMessage(
          error,
          "Could not save image preferences. Refresh and try again.",
        ),
      ),
  });
  const upload = useMutation({
    mutationFn: async () => {
      if (!file) throw new Error("Choose an image to upload.");
      return uploadProjectFeaturedAsset({
        data: {
          projectId,
          filename: file.name,
          imageBase64: await readImage(file),
          sourceUrl: sourceUrl.trim() || undefined,
          rightsNote,
          altText,
        },
      });
    },
    onSuccess: (newAsset) => {
      toast.success(
        "Project image added. Save preferences to make it the preferred image.",
      );
      setPreferredAssetId(newAsset?.id ?? null);
      setFile(null);
      setFileInputVersion((value) => value + 1);
      setSourceUrl("");
      setRightsNote("");
      setAltText("");
      void client.invalidateQueries({ queryKey: key });
    },
    onError: (error) =>
      toast.error(
        getStandardErrorMessage(
          error,
          "Could not upload the project image. Check its size and rights details.",
        ),
      ),
  });

  return (
    <section className="space-y-5" aria-label="Featured image settings">
      <div className="space-y-1">
        <h3 className="font-semibold">Featured images</h3>
        <p className="text-sm text-base-content/70">
          Set a visual direction for article images. A preferred project image
          can be reused for articles without a custom image brief.
        </p>
      </div>
      {query.isPending && (
        <p role="status" className="text-sm">
          Loading image preferences…
        </p>
      )}
      {query.isError && (
        <div className="space-y-2">
          <p role="alert" className="text-sm text-error">
            Could not load image preferences.
          </p>
          <button
            type="button"
            className="btn btn-sm"
            onClick={() => void query.refetch()}
          >
            Retry
          </button>
        </div>
      )}
      {query.data && (
        <>
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              save.mutate();
            }}
          >
            <label className="flex items-start gap-3 text-sm">
              <input
                className="checkbox checkbox-sm mt-0.5"
                type="checkbox"
                checked={autoGenerate}
                onChange={(event) => setAutoGenerate(event.target.checked)}
              />
              <span>
                <span className="font-medium">Automatically add a featured image to new and revised articles</span>
                <span className="mt-1 block text-base-content/70">
                  When off, images can still be generated or uploaded for individual articles.
                </span>
              </span>
            </label>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block text-sm">
                Visual style
                <input
                  className="input input-bordered mt-1 w-full"
                  maxLength={300}
                  value={style}
                  onChange={(event) => setStyle(event.target.value)}
                  placeholder="e.g. clean editorial illustration"
                />
              </label>
              <label className="block text-sm">
                Colors
                <input
                  className="input input-bordered mt-1 w-full"
                  maxLength={180}
                  value={colors}
                  onChange={(event) => setColors(event.target.value)}
                  placeholder="e.g. navy, cream, muted orange"
                />
              </label>
            </div>
            <label className="block text-sm">
              Visual reference notes
              <textarea
                className="textarea textarea-bordered mt-1 w-full"
                rows={2}
                maxLength={300}
                value={reference}
                onChange={(event) => setReference(event.target.value)}
                placeholder="Describe a visual example or composition"
              />
            </label>
            <label className="block text-sm">
              Avoid
              <textarea
                className="textarea textarea-bordered mt-1 w-full"
                rows={2}
                maxLength={300}
                value={avoid}
                onChange={(event) => setAvoid(event.target.value)}
                placeholder="Visual elements to avoid"
              />
            </label>
            <label className="block text-sm">
              Remembered image guidance
              <textarea
                className="textarea textarea-bordered mt-1 w-full"
                rows={3}
                maxLength={1000}
                value={guidance}
                onChange={(event) => setGuidance(event.target.value)}
                placeholder="Feedback that should guide future article images"
              />
            </label>

            <div className="space-y-3 border-t border-base-300 pt-4">
              <div>
                <h4 className="font-medium">Preferred project image</h4>
                <p className="text-sm text-base-content/70">
                  Choose a reusable client image. When automatic images are
                  enabled, articles without a custom image brief use it; leave
                  this empty to generate from article briefs.
                </p>
              </div>
              <label className="block text-sm">
                Image library
                <select
                  className="select select-bordered mt-1 w-full"
                  value={preferredAssetId ?? ""}
                  onChange={(event) =>
                    setPreferredAssetId(event.target.value || null)
                  }
                >
                  <option value="">No preferred image</option>
                  {query.data.assets.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.filename}
                    </option>
                  ))}
                </select>
              </label>
              {preferredAssetId && preview.isPending && (
                <p role="status" className="text-sm">
                  Loading project image…
                </p>
              )}
              {preferredAssetId && preview.isError && (
                <p role="alert" className="text-sm text-error">
                  Could not preview this project image.
                </p>
              )}
              {preview.data?.base64 && (
                <figure className="space-y-2">
                  <div className="aspect-video w-full max-w-xl overflow-hidden rounded bg-base-200">
                    <img
                      className="h-full w-full object-contain"
                      src={`data:image/webp;base64,${preview.data.base64}`}
                      alt={preview.data.altText}
                    />
                  </div>
                  <figcaption className="text-xs text-base-content/70">
                    {asset?.filename} ·{" "}
                    {asset && `${(asset.bytes / 1000).toFixed(0)} KB`}
                    {asset?.rightsNote && ` · ${asset.rightsNote}`}
                  </figcaption>
                </figure>
              )}
            </div>
            <button
              className="btn btn-sm btn-primary"
              type="submit"
              disabled={save.isPending || upload.isPending}
            >
              {save.isPending ? "Saving…" : "Save image preferences"}
            </button>
          </form>

          <form
            className="space-y-3 border-t border-base-300 pt-5"
            onSubmit={(event) => {
              event.preventDefault();
              upload.mutate();
            }}
          >
            <div>
              <h4 className="font-medium">Add a project image</h4>
              <p className="text-sm text-base-content/70">
                Upload an approved client photo for the library. It is resized
                to a 1280 × 720 WebP.
              </p>
            </div>
            <label className="block text-sm">
              Image file
              <input
                key={fileInputVersion}
                className="file-input file-input-bordered mt-1 w-full"
                type="file"
                accept="image/jpeg,image/png,image/webp"
                onChange={(event) => setFile(event.target.files?.[0] ?? null)}
              />
            </label>
            <label className="block text-sm">
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
            <label className="block text-sm">
              Rights or permission note
              <textarea
                className="textarea textarea-bordered mt-1 w-full"
                rows={2}
                maxLength={1000}
                value={rightsNote}
                onChange={(event) => setRightsNote(event.target.value)}
                placeholder="Who supplied it, and what use is allowed?"
              />
            </label>
            <label className="block text-sm">
              Alt text for this image
              <input
                className="input input-bordered mt-1 w-full"
                maxLength={300}
                value={altText}
                onChange={(event) => setAltText(event.target.value)}
                placeholder="Describe what is actually shown"
              />
            </label>
            <button
              className="btn btn-sm"
              type="submit"
              disabled={
                upload.isPending ||
                save.isPending ||
                !file ||
                rightsNote.trim().length < 10 ||
                altText.trim().length < 15
              }
            >
              {upload.isPending ? "Uploading…" : "Add to image library"}
            </button>
          </form>
        </>
      )}
    </section>
  );
}
