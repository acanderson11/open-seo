import { describe, expect, it } from "vitest";
import { questionnaireContextSuggestions } from "./agencyQuestionnaireContext";
describe("questionnaire native Context mapping", () => {
  it("maps business and writing answers to native sections without inventing goals", () => {
    const items = [
      { field: "services" as const, value: "Web design", source: "https://example.com", evidence: "Customer answer" },
      { field: "voice" as const, value: "Plain", source: "https://example.com", evidence: "Customer answer" },
    ];
    expect(questionnaireContextSuggestions(items)).toEqual([
      { section: "business_overview", content: "Services: Web design" },
      { section: "writing_preferences", content: "Voice: Plain" },
    ]);
    expect(questionnaireContextSuggestions([])).toEqual([]);
  });
  it("preserves oversized source answers for review rather than silently truncating", () => {
    const item = { field: "facts" as const, value: "x".repeat(5000), source: "https://example.com", evidence: "Customer answer" };
    expect(questionnaireContextSuggestions([item])[0].content).toContain(item.value);
  });
});
