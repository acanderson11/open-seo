import { z } from "zod";
import type { ProjectContextUpdate } from "./projectContext";
export const AGENCY_FIELDS = [
  { key: "audience", label: "Ideal customers" },
  { key: "services", label: "Services to promote" },
  { key: "locations", label: "Locations served" },
  { key: "voice", label: "Brand voice" },
  { key: "tone", label: "Tone and writing examples" },
  { key: "facts", label: "Approved business facts" },
  { key: "exclusions", label: "Exclusions and claims to avoid" },
] as const;
export const US_TIMEZONES = [
  ["America/New_York", "Eastern — New York"],
  ["America/Chicago", "Central — Chicago"],
  ["America/Denver", "Mountain — Denver"],
  ["America/Phoenix", "Arizona — no daylight saving time"],
  ["America/Los_Angeles", "Pacific — Los Angeles"],
  ["America/Anchorage", "Alaska — Anchorage"],
  ["America/Adak", "Aleutian Islands — Adak"],
  ["Pacific/Honolulu", "Hawaii — no daylight saving time"],
  ["America/Puerto_Rico", "Atlantic — Puerto Rico / US Virgin Islands"],
  ["Pacific/Guam", "Chamorro — Guam / Northern Mariana Islands"],
  ["Pacific/Pago_Pago", "Samoa — American Samoa"],
] as const;
export type AgencyField = (typeof AGENCY_FIELDS)[number]["key"] | "timezone";
const prose = z.string().trim().max(2000);
export const agencyProfilePatchSchema = z.strictObject({
  projectId: z.string().min(1),
  fields: z
    .strictObject({
      audience: prose.optional(),
      services: prose.optional(),
      locations: prose.optional(),
      voice: prose.optional(),
      tone: prose.optional(),
      facts: prose.optional(),
      exclusions: prose.optional(),
      timezone: z
        .string()
        .refine(
          (value) => US_TIMEZONES.some(([zone]) => zone === value),
          "Choose a US time zone",
        )
        .optional(),
    })
    .refine((fields) => Object.keys(fields).length > 0, "No changes to save"),
});
export function agencyProfileUpdates(
  fields: z.infer<typeof agencyProfilePatchSchema>["fields"],
): ProjectContextUpdate[] {
  return Object.entries(fields).flatMap(([key, content]) =>
    content === undefined
      ? []
      : [
          {
            customSection: `agency-${key}`,
            title:
              key === "timezone"
                ? "Agency reporting time zone"
                : AGENCY_FIELDS.find((field) => field.key === key)!.label,
            content,
          },
        ],
  );
}
export function readAgencyProfile(
  sections: { slug: string; content: string }[],
): Partial<Record<AgencyField, string>> {
  const fields: Partial<Record<AgencyField, string>> = {};
  for (const key of [
    ...AGENCY_FIELDS.map((field) => field.key),
    "timezone",
  ] as const) {
    const section = sections.find((row) => row.slug === `agency-${key}`);
    if (section) fields[key] = section.content;
  }
  return fields;
}
