import { z } from "zod";
import { getOptionalEnvValue } from "@/server/lib/runtime-env";
import { AppError } from "@/server/lib/errors";
import { decodeImageBase64 } from "./FeaturedImageCodec";

const DEFAULT_MODEL = "recraft/recraft-v4.1-flash";
export const IMAGE_PROMPT_LIMIT = 5_000;
export function redirectTarget(response: Response) {
  try {
    const location = response.headers.get("location");
    if (!location) return "unknown target";
    const target = new URL(location, "https://openrouter.ai/api/v1/images");
    return `${target.origin}${target.pathname}`;
  } catch {
    return "unknown target";
  }
}
export function classifyProviderRequestFailure(error: unknown) {
  const name = error instanceof Error ? error.name : "";
  const message = error instanceof Error ? error.message : "";
  if (name === "TimeoutError" || name === "AbortError")
    return "timed out or was aborted";
  if (/unsupported|not implemented|invalid option/i.test(message))
    return "failed because a request option was unsupported";
  if (/redirect/i.test(message)) return "failed while applying redirect policy";
  if (/signal|abort/i.test(message))
    return "failed while setting up the abort signal";
  if (/header/i.test(message)) return "failed request-header validation";
  if (/dns|network|connect|socket|fetch failed/i.test(message))
    return "failed at the network connection";
  return name === "TypeError"
    ? "failed during request construction or connection"
    : "failed before a valid response";
}
const responseSchema = z.object({
  data: z
    .array(
      z.object({
        b64_json: z.string().min(100).max(16_000_000),
        media_type: z.string().optional(),
      }),
    )
    .length(1),
  usage: z.object({ cost: z.number().nonnegative().optional() }).optional(),
});

export async function generateConceptualImage(prompt: string) {
  const key = await getOptionalEnvValue("OPENROUTER_API_KEY");
  if (!key) throw new AppError("AUTH_CONFIG_MISSING");
  const model =
    (await getOptionalEnvValue("OPENROUTER_IMAGE_MODEL")) || DEFAULT_MODEL;
  if (!/^[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*$/i.test(model))
    throw new AppError("VALIDATION_ERROR");
  let response: Response;
  try {
    response = await fetch("https://openrouter.ai/api/v1/images", {
      method: "POST",
      headers: {
        authorization: `Bearer ${key}`,
        "content-type": "application/json",
        "HTTP-Referer": "https://openseo.so",
        "X-Title": "OpenSEO",
      },
      body: JSON.stringify({
        model,
        prompt: prompt.slice(0, IMAGE_PROMPT_LIMIT),
        aspect_ratio: "16:9",
        n: 1,
      }),
      signal: AbortSignal.timeout(45_000),
      redirect: "manual",
    });
  } catch (error) {
    const category = classifyProviderRequestFailure(error);
    throw new AppError(
      "UPSTREAM_UNAVAILABLE",
      `Image provider request ${category}; outcome is uncertain. Check provider usage before another attempt.`,
    );
  }
  if (response.status >= 300 && response.status < 400)
    throw new AppError(
      "UPSTREAM_UNAVAILABLE",
      `Image provider returned HTTP ${response.status} redirect to ${redirectTarget(response)}; no credentials were forwarded.`,
    );
  if (!response.ok)
    throw new AppError(
      "UPSTREAM_UNAVAILABLE",
      `Image provider rejected the request (HTTP ${response.status}).`,
    );
  const reader = response.body?.getReader();
  if (!reader)
    throw new AppError(
      "UPSTREAM_UNAVAILABLE",
      "Image provider response had no body.",
    );
  const decoder = new TextDecoder();
  let text = "";
  let complete = false;
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) {
        complete = true;
        break;
      }
      text += decoder.decode(chunk.value, { stream: true });
      if (text.length > 22_000_000)
        throw new AppError(
          "UPSTREAM_UNAVAILABLE",
          "Image provider response exceeded the size limit.",
        );
    }
  } finally {
    if (!complete) await reader.cancel().catch(() => {});
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text + decoder.decode());
  } catch {
    throw new AppError(
      "UPSTREAM_UNAVAILABLE",
      "Image provider returned malformed JSON.",
    );
  }
  const validated = responseSchema.safeParse(raw);
  if (!validated.success)
    throw new AppError(
      "UPSTREAM_UNAVAILABLE",
      "Image provider response did not contain one valid raster image.",
    );
  const parsed = validated.data;
  if (
    parsed.data[0].media_type &&
    !["image/png", "image/jpeg", "image/webp"].includes(
      parsed.data[0].media_type,
    )
  )
    throw new AppError(
      "UPSTREAM_UNAVAILABLE",
      "Image provider returned an unsupported media type.",
    );
  let bytes: Uint8Array;
  try {
    bytes = decodeImageBase64(parsed.data[0].b64_json);
  } catch {
    throw new AppError(
      "UPSTREAM_UNAVAILABLE",
      "Image provider returned invalid base64 image bytes.",
    );
  }
  return {
    bytes,
    model,
    costUsd: parsed.usage?.cost?.toString() ?? null,
  };
}
