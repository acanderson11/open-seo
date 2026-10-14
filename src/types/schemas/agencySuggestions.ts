import { z } from "zod";
export const profileSuggestionSchema = z.object({
  field: z.enum([
    "audience",
    "services",
    "locations",
    "voice",
    "tone",
    "facts",
    "exclusions",
  ]),
  value: z.string().trim().min(1).max(2000),
  source: z.string().url().max(600),
  evidence: z.string().trim().min(10).max(600),
});
export const profileSuggestionsSchema = z.object({
  suggestions: z.array(profileSuggestionSchema).max(7),
  warnings: z.array(z.string().max(500)).max(10),
});
export type ProfileSuggestion = z.infer<typeof profileSuggestionSchema>;
const normalize = (value: string) =>
  value.normalize("NFKC").replace(/\s+/g, " ").trim();
export function groundProfileSuggestions(
  items: ProfileSuggestion[],
  pages: { url: string; text: string }[],
) {
  const seen = new Set<string>();
  return items
    .filter((item) => {
      const page = pages.find((candidate) => candidate.url === item.source);
      if (
        !page ||
        !normalize(page.text).includes(normalize(item.evidence)) ||
        seen.has(item.field)
      )
        return false;
      if (
        item.field === "locations" &&
        /case stud|client|customer|\d\s*%/i.test(item.evidence)
      )
        return false;
      seen.add(item.field);
      return true;
    })
    .map((item) => ({
      ...item,
      value:
        ["voice", "tone"].includes(item.field) &&
        !item.value.startsWith("Inferred from website:")
          ? `Inferred from website: ${item.value}`.slice(0, 2000)
          : item.value,
    }));
}
