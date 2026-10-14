import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { getStandardErrorMessage } from "@/client/lib/error-messages";
import { uploadProjectFeaturedAsset } from "@/serverFunctions/featuredImages";
import { readImageFile } from "./readImageFile";

export const projectImageSettingsKey = (projectId: string) => [
  "project-image-settings",
  projectId,
];
// Saving preferences and uploading an image disable each other.
export const projectImageMutationKey = (projectId: string) => [
  "project-image",
  projectId,
];

export function AddProjectImageForm({
  projectId,
  busy,
  onAdded,
}: {
  projectId: string;
  busy: boolean;
  onAdded: (assetId: string | null) => void;
}) {
  const client = useQueryClient();
  const [file, setFile] = useState<File | null>(null);
  const [fileInputVersion, setFileInputVersion] = useState(0);
  const [sourceUrl, setSourceUrl] = useState("");
  const [rightsNote, setRightsNote] = useState("");
  const [altText, setAltText] = useState("");
  const upload = useMutation({
    mutationKey: projectImageMutationKey(projectId),
    mutationFn: async (image: File) =>
      uploadProjectFeaturedAsset({
        data: {
          projectId,
          filename: image.name,
          imageBase64: await readImageFile(image),
          sourceUrl: sourceUrl.trim() || undefined,
          rightsNote,
          altText,
        },
      }),
    onSuccess: (newAsset) => {
      toast.success(
        "Project image added. Save preferences to make it the preferred image.",
      );
      onAdded(newAsset?.id ?? null);
      setFile(null);
      setFileInputVersion((value) => value + 1);
      setSourceUrl("");
      setRightsNote("");
      setAltText("");
      void client.invalidateQueries({
        queryKey: projectImageSettingsKey(projectId),
      });
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
    <form
      className="space-y-3 border-t border-base-300 pt-5"
      onSubmit={(event) => {
        event.preventDefault();
        if (file) upload.mutate(file);
      }}
    >
      <div>
        <h4 className="font-medium">Add a project image</h4>
        <p className="text-sm text-base-content/70">
          Upload an approved client photo for the library. It is resized to a
          1280 × 720 WebP.
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
          busy ||
          !file ||
          rightsNote.trim().length < 10 ||
          altText.trim().length < 15
        }
      >
        {upload.isPending ? "Uploading…" : "Add to image library"}
      </button>
    </form>
  );
}
