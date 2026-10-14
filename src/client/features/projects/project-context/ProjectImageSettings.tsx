import { useState } from "react";
import {
  useIsMutating,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { toast } from "sonner";
import { getStandardErrorMessage } from "@/client/lib/error-messages";
import {
  getProjectFeaturedAssetData,
  getProjectImageSettings,
  saveProjectImageSettings,
} from "@/serverFunctions/featuredImages";
import {
  AddProjectImageForm,
  projectImageMutationKey as mutationKey,
  projectImageSettingsKey as settingsKey,
} from "./AddProjectImageForm";

export type ProjectImageSettingsProps = {
  projectId: string;
  onSaved: () => void;
};

type Settings = Awaited<ReturnType<typeof getProjectImageSettings>>;

export function ProjectImageSettings({
  projectId,
  onSaved,
}: ProjectImageSettingsProps) {
  const query = useQuery({
    queryKey: settingsKey(projectId),
    queryFn: () => getProjectImageSettings({ data: { projectId } }),
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
        // Remount with fresh form state whenever saved preferences change.
        <ImagePreferencesForm
          key={query.data.preferences?.version ?? "new"}
          projectId={projectId}
          settings={query.data}
          onSaved={onSaved}
        />
      )}
    </section>
  );
}

function ImagePreferencesForm({
  projectId,
  settings,
  onSaved,
}: {
  projectId: string;
  settings: Settings;
  onSaved: () => void;
}) {
  const client = useQueryClient();
  const saved = settings.preferences;
  const [autoGenerate, setAutoGenerate] = useState(saved?.autoGenerate === 1);
  const [style, setStyle] = useState(saved?.style ?? "");
  const [colors, setColors] = useState(saved?.colors ?? "");
  const [reference, setReference] = useState(saved?.reference ?? "");
  const [avoid, setAvoid] = useState(saved?.avoid ?? "");
  const [guidance, setGuidance] = useState(saved?.guidance ?? "");
  const [preferredAssetId, setPreferredAssetId] = useState<string | null>(
    saved?.preferredAssetId ?? null,
  );
  const busy = useIsMutating({ mutationKey: mutationKey(projectId) }) > 0;
  const asset = settings.assets.find((item) => item.id === preferredAssetId);
  const preview = useQuery({
    queryKey: ["project-image-asset", projectId, preferredAssetId],
    queryFn: () =>
      getProjectFeaturedAssetData({
        data: { projectId, assetId: preferredAssetId! },
      }),
    enabled: !!preferredAssetId,
  });
  const save = useMutation({
    mutationKey: mutationKey(projectId),
    mutationFn: () =>
      saveProjectImageSettings({
        data: {
          projectId,
          expectedVersion: saved?.version ?? null,
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
      void client.invalidateQueries({ queryKey: settingsKey(projectId) });
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
  return (
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
            <span className="font-medium">
              Automatically add a featured image to new and revised articles
            </span>
            <span className="mt-1 block text-base-content/70">
              When off, images can still be generated or uploaded for individual
              articles.
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
              Choose a reusable client image. When automatic images are enabled,
              articles without a custom image brief use it; leave this empty to
              generate from article briefs.
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
              {settings.assets.map((item) => (
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
          disabled={busy}
        >
          {save.isPending ? "Saving…" : "Save image preferences"}
        </button>
      </form>
      <AddProjectImageForm
        projectId={projectId}
        busy={busy}
        onAdded={setPreferredAssetId}
      />
    </>
  );
}
