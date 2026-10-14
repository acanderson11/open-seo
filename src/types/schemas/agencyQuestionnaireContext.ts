import type { ProfileSuggestion } from "./agencySuggestions";
import type { ProjectContextSectionKey } from "./projectContext";
// Adapt the questionnaire's field names to OpenSEO's existing memory schema.
// This creates reviewable drafts only, never a parallel profile or automatic merge.
export function questionnaireContextSuggestions(items: ProfileSuggestion[]) {
  const groups: {
    section: ProjectContextSectionKey;
    fields: ProfileSuggestion["field"][];
  }[] = [
    {
      section: "business_overview",
      fields: ["services", "audience", "locations", "facts"],
    },
    { section: "writing_preferences", fields: ["voice", "tone", "exclusions"] },
  ];
  const labels = {
    services: "Services",
    audience: "Audience",
    locations: "Locations",
    facts: "Business details",
    voice: "Voice",
    tone: "Tone",
    exclusions: "Avoid",
  };
  return groups.flatMap((group) => {
    const content = group.fields
      .flatMap((field) =>
        items
          .filter((item) => item.field === field)
          .map((item) => labels[field] + ": " + item.value),
      )
      .join("\n\n");
    return content ? [{ section: group.section, content }] : [];
  });
}
