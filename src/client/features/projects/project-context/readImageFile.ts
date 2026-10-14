/** Reads an uploaded JPEG, PNG, or WebP (under 12 MB) as base64 without the data-URL prefix. */
export async function readImageFile(file: File) {
  if (
    !["image/jpeg", "image/png", "image/webp"].includes(file.type) ||
    file.size > 12_000_000
  )
    throw new Error("Choose a JPEG, PNG, or WebP image under 12 MB.");
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("error", () =>
      reject(new Error("Could not read the selected image.")),
    );
    reader.addEventListener("load", () =>
      resolve(
        typeof reader.result === "string"
          ? (reader.result.split(",")[1] ?? "")
          : "",
      ),
    );
    reader.readAsDataURL(file);
  });
}
