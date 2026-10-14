import { automationResultSchema } from "@/types/schemas/automation";
import { AppError } from "@/server/lib/errors";
export async function boundedResult(response: Response) {
  const reader = response.body?.getReader();
  if (!reader) throw new AppError("UPSTREAM_UNAVAILABLE");
  let size = 0,
    body = "";
  const decoder = new TextDecoder();
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > 600000) throw new AppError("UPSTREAM_UNAVAILABLE");
      body += decoder.decode(chunk.value, { stream: true });
    }
  } finally {
    await reader.cancel();
  }
  return automationResultSchema.parse(JSON.parse(body + decoder.decode()));
}
