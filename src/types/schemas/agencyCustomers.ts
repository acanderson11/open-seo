import { z } from "zod";
import type { ProfileSuggestion } from "@/types/schemas/agencySuggestions";
const answer = z.string().nullable().optional();
export const customerRowSchema = z.object({
  id: z.coerce.number().int().positive(),
  BusinessName: answer,
  Customer: answer,
  WebsiteURL: answer,
  Services: answer,
  ServiceArea: answer,
  TargetAudience: answer,
  CompanyVoice: answer,
  AboutBusiness: answer,
  USP: answer,
  OriginStory: answer,
});
export function websiteHost(value: string) {
  try {
    const url = new URL(
      /^https?:\/\//i.test(value.trim())
        ? value.trim()
        : `https://${value.trim()}`,
    );
    return /^https?:$/.test(url.protocol) && !url.username && !url.password
      ? url.hostname.toLowerCase().replace(/^www\./, "")
      : "";
  } catch {
    return "";
  }
}
export function questionnaireSuggestions(
  row: z.infer<typeof customerRowSchema>,
  source: string,
) {
  const fields = [
    ["audience", row.TargetAudience],
    ["services", row.Services],
    ["locations", row.ServiceArea],
    ["voice", row.CompanyVoice],
    [
      "facts",
      [row.AboutBusiness, row.USP, row.OriginStory]
        .filter(Boolean)
        .join("\n\n"),
    ],
  ] as const;
  const suggestions: ProfileSuggestion[] = [],
    warnings: string[] = [];
  for (const [field, raw] of fields) {
    const value = raw?.trim();
    if (!value) continue;
    if (value.length > 2000) {
      warnings.push(
        `${field}: answer exceeds 2,000 characters. Shorten it before importing.`,
      );
      continue;
    }
    suggestions.push({
      field,
      value,
      source,
      evidence: `Customers row ${row.id}: ${value.slice(0, 550)}`,
    });
  }
  return { suggestions, warnings };
}
