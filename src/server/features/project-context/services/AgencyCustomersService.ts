import { z } from "zod";
import { getOptionalEnvValue } from "@/server/lib/runtime-env";
import { AppError } from "@/server/lib/errors";
import {
  customerRowSchema,
  questionnaireSuggestions,
  websiteHost,
} from "@/types/schemas/agencyCustomers";
const TABLE_ID = "RLjJledGZa2ZBRf5";
const source = `https://n8n.andmktg.com/projects/cXWRX4xyhj6SYmuN/datatables/${TABLE_ID}`;
const pageSchema = z.object({
  data: z.array(customerRowSchema),
  nextCursor: z.string().nullable().optional(),
});
async function readBoundedJson(response: Response) {
  const reader = response.body?.getReader();
  if (!reader) throw new AppError("UPSTREAM_UNAVAILABLE");
  let size = 0,
    text = "";
  const decoder = new TextDecoder();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 2_000_000) throw new AppError("UPSTREAM_UNAVAILABLE");
      text += decoder.decode(value, { stream: true });
    }
    return pageSchema.parse(JSON.parse(text + decoder.decode()));
  } finally {
    await reader.cancel();
  }
}
// Fixed destination; this secret never reaches the browser, model, or redirects.
export async function previewCustomers(domain: string) {
  const apiKey = await getOptionalEnvValue("AGENCY_N8N_API_KEY");
  if (!apiKey) return { connected: false as const, records: [] };
  const host = websiteHost(domain);
  if (!host) throw new AppError("VALIDATION_ERROR");
  const records = [],
    cursors = new Set<string>();
  let cursor = "";
  const signal = AbortSignal.timeout(25000);
  for (let index = 0; index < 20; index++) {
    const url = new URL(
      `https://n8n.andmktg.com/api/v1/data-tables/${TABLE_ID}/rows`,
    );
    url.searchParams.set("limit", "100");
    if (cursor) url.searchParams.set("cursor", cursor);
    const response = await fetch(url, {
      headers: { "X-N8N-API-KEY": apiKey, Accept: "application/json" },
      redirect: "manual",
      signal,
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new AppError("UPSTREAM_UNAVAILABLE");
    }
    const page = await readBoundedJson(response);
    for (const row of page.data) {
      if (websiteHost(row.WebsiteURL || "") !== host) continue;
      records.push({
        id: row.id,
        name: row.BusinessName || row.Customer || `Row ${row.id}`,
        ...questionnaireSuggestions(row, source),
      });
    }
    cursor = page.nextCursor || "";
    if (!cursor)
      return {
        connected: true as const,
        records,
      };
    if (cursors.has(cursor)) break;
    cursors.add(cursor);
  }
  throw new AppError("UPSTREAM_UNAVAILABLE");
}
