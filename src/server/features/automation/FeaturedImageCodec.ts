import { env } from "cloudflare:workers";
import { AppError } from "@/server/lib/errors";

const WEBP_TARGET_BYTES = 200_000;
const MAX_INPUT_BYTES = 12_000_000;
export const FEATURED_WIDTH = 1280;
export const FEATURED_HEIGHT = 720;

const stream = (bytes: Uint8Array) =>
  new Blob([Uint8Array.from(bytes)]).stream();

export async function normalizeFeaturedImage(bytes: Uint8Array) {
  if (!bytes.length || bytes.length > MAX_INPUT_BYTES)
    throw new AppError("VALIDATION_ERROR");
  let info: Awaited<ReturnType<typeof env.IMAGES.info>>;
  try {
    info = await env.IMAGES.info(stream(bytes));
  } catch {
    throw new AppError(
      "UPSTREAM_UNAVAILABLE",
      "Cloudflare Images could not inspect the source image.",
    );
  }
  if (
    !("width" in info) ||
    !["image/jpeg", "image/png", "image/webp"].includes(info.format)
  )
    throw new AppError(
      "VALIDATION_ERROR",
      "Cloudflare Images reported an unsupported source format.",
    );
  if (
    info.width < 640 ||
    info.height < 360 ||
    info.width > 8192 ||
    info.height > 8192 ||
    info.width * info.height > 24_000_000 ||
    info.fileSize > MAX_INPUT_BYTES
  )
    throw new AppError(
      "VALIDATION_ERROR",
      "Source image dimensions or byte size are outside the accepted range.",
    );
  for (const quality of [82, 72, 62]) {
    let transformed: Awaited<
      ReturnType<ReturnType<typeof env.IMAGES.input>["output"]>
    >;
    try {
      transformed = await env.IMAGES.input(stream(bytes))
        .transform({
          width: FEATURED_WIDTH,
          height: FEATURED_HEIGHT,
          fit: "cover",
          gravity: "center",
        })
        .output({ format: "image/webp", quality, anim: false });
    } catch {
      throw new AppError(
        "UPSTREAM_UNAVAILABLE",
        "Cloudflare Images WebP conversion failed.",
      );
    }
    const response = transformed.response();
    if (!response.ok)
      throw new AppError(
        "UPSTREAM_UNAVAILABLE",
        `Cloudflare Images WebP conversion returned HTTP ${response.status}.`,
      );
    const result = new Uint8Array(await response.arrayBuffer());
    if (result.length > WEBP_TARGET_BYTES) continue;
    let verified: Awaited<ReturnType<typeof env.IMAGES.info>>;
    try {
      verified = await env.IMAGES.info(stream(result));
    } catch {
      throw new AppError(
        "UPSTREAM_UNAVAILABLE",
        "Cloudflare Images could not verify the WebP output.",
      );
    }
    if (
      !("width" in verified) ||
      verified.width !== FEATURED_WIDTH ||
      verified.height !== FEATURED_HEIGHT ||
      verified.format !== "image/webp"
    )
      throw new AppError(
        "UPSTREAM_UNAVAILABLE",
        "Cloudflare Images returned unexpected output dimensions or format.",
      );
    return { bytes: result, quality };
  }
  throw new AppError(
    "UPSTREAM_UNAVAILABLE",
    "Image could not meet the 200 KB target without excessive compression.",
  );
}

export async function storeFeaturedImage(key: string, bytes: Uint8Array) {
  await env.R2.put(key, bytes, {
    httpMetadata: {
      contentType: "image/webp",
      cacheControl: "private, max-age=3600",
    },
  });
}

export async function readFeaturedImage(key: string) {
  const object = await env.R2.get(key);
  if (!object) throw new AppError("NOT_FOUND");
  if (object.size > WEBP_TARGET_BYTES || object.size < 100)
    throw new AppError("UPSTREAM_UNAVAILABLE");
  const bytes = new Uint8Array(await object.arrayBuffer());
  if (
    bytes.length > WEBP_TARGET_BYTES ||
    bytes.length < 100 ||
    bytes[0] !== 0x52 ||
    bytes[1] !== 0x49 ||
    bytes[2] !== 0x46 ||
    bytes[3] !== 0x46 ||
    bytes[8] !== 0x57 ||
    bytes[9] !== 0x45 ||
    bytes[10] !== 0x42 ||
    bytes[11] !== 0x50
  )
    throw new AppError("UPSTREAM_UNAVAILABLE");
  return bytes;
}

export function decodeImageBase64(value: string) {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value) || value.length > 16_000_000)
    throw new AppError("VALIDATION_ERROR");
  return Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
}

export function encodeImageBase64(bytes: Uint8Array) {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 8192)
    binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(binary);
}
