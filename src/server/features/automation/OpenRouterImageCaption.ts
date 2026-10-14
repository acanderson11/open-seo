import { z } from "zod";
import { getOptionalEnvValue } from "@/server/lib/runtime-env";
import { encodeImageBase64 } from "./FeaturedImageCodec";

const captionSchema = z.object({
  alt: z.string().trim().max(220),
  forbidden: z.boolean(),
  reason: z.string().trim().max(200).optional(),
});

/** A single bounded visual check. Failure leaves the article without a selected image. */
export async function captionConceptualImage(bytes: Uint8Array) {
  const key = await getOptionalEnvValue("OPENROUTER_API_KEY");
  if (!key) return { alt: "", forbidden: false };
  try {
    const response = await fetch(
      "https://openrouter.ai/api/v1/chat/completions",
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${key}`,
          "content-type": "application/json",
          "HTTP-Referer": "https://openseo.so",
          "X-Title": "OpenSEO",
        },
        body: JSON.stringify({
          model: "google/gemini-2.5-flash-lite",
          max_tokens: 160,
          temperature: 0,
          messages: [
            {
              role: "user",
              content: [
                {
                  type: "text",
                  text: "Inspect the image itself, not the article topic. Return JSON with alt (15-160 characters describing only visible objects), forbidden (true only for visible writing, numbers, logos, watermarks, invented software interfaces or charts), and reason (briefly identify the visible problem when forbidden is true; otherwise empty). Blank paper, unmarked objects, cables and an unlit screen alone are not forbidden. Do not infer text or a logo from the subject matter. No markdown.",
                },
                {
                  type: "image_url",
                  image_url: {
                    url: `data:image/webp;base64,${encodeImageBase64(bytes)}`,
                  },
                },
              ],
            },
          ],
        }),
        signal: AbortSignal.timeout(15_000),
        redirect: "manual",
      },
    );
    if (
      !response.ok ||
      Number(response.headers.get("content-length") ?? 0) > 16_000
    )
      return { alt: "", forbidden: false };
    const reader = response.body?.getReader();
    if (!reader) return { alt: "", forbidden: false };
    const decoder = new TextDecoder();
    let text = "";
    let size = 0;
    let complete = false;
    try {
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) {
          complete = true;
          break;
        }
        size += chunk.value.length;
        if (size > 16_000) return { alt: "", forbidden: false };
        text += decoder.decode(chunk.value, { stream: true });
      }
      text += decoder.decode();
    } finally {
      if (!complete) await reader.cancel().catch(() => {});
    }
    const content = z
      .object({
        choices: z
          .array(z.object({ message: z.object({ content: z.string() }) }))
          .min(1),
      })
      .parse(JSON.parse(text)).choices[0].message.content;
    const parsed = captionSchema.parse(
      JSON.parse(content.replace(/^```(?:json)?\s*|\s*```$/g, "")),
    );
    return {
      alt: parsed.alt.length >= 15 ? parsed.alt : "",
      forbidden: parsed.forbidden,
      reason: parsed.reason ?? "",
    };
  } catch {
    return { alt: "", forbidden: false };
  }
}
