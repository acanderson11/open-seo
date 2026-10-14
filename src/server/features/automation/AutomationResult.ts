import { automationResultSchema } from "@/types/schemas/automation";
import { AppError } from "@/server/lib/errors";

/** Reads a JSON response from n8n or WordPress, refusing bodies over 600 KB. */
export async function boundedJson(response: Response): Promise<unknown> {
  if (!response.ok) throw new AppError("UPSTREAM_UNAVAILABLE");
  const reader = response.body?.getReader();
  if (!reader) throw new AppError("UPSTREAM_UNAVAILABLE");
  const decoder = new TextDecoder();
  let bytes = 0,
    text = "";
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > 600_000) throw new AppError("UPSTREAM_UNAVAILABLE");
      text += decoder.decode(chunk.value, { stream: true });
    }
  } finally {
    await reader.cancel();
  }
  return JSON.parse(text + decoder.decode());
}

export async function boundedResult(response: Response) {
  return automationResultSchema.parse(await boundedJson(response));
}
