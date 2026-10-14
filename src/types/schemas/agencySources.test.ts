import { describe, expect, it } from "vitest";
import {
  customerRowSchema,
  questionnaireSuggestions,
  websiteHost,
} from "./agencyCustomers";
import { groundProfileSuggestions } from "./agencySuggestions";
describe("agency source boundaries", () => {
  it("matches exact website hosts, not suffix impostors or credential URLs", () => {
    expect(websiteHost("https://www.andmktg.com/about")).toBe("andmktg.com");
    expect(websiteHost("https://andmktg.com.evil.com")).not.toBe("andmktg.com");
    expect(websiteHost("https://user:secret@andmktg.com")).toBe("");
  });
  it("strips private columns and maps only supported questionnaire fields", () => {
    const row = customerRowSchema.parse({
      id: 13,
      Services: "Web design",
      password: "secret",
      Email: "private@example.com",
    });
    expect(row).not.toHaveProperty("password");
    expect(row).not.toHaveProperty("Email");
    expect(
      questionnaireSuggestions(row, "https://n8n.andmktg.com").suggestions,
    ).toEqual([
      expect.objectContaining({ field: "services", value: "Web design" }),
    ]);
  });
  it("does not truncate long questionnaire answers into misleading claims", () => {
    const result = questionnaireSuggestions(
      { id: 13, Services: "x".repeat(2001) },
      "https://n8n.andmktg.com",
    );
    expect(result.suggestions).toEqual([]);
    expect(result.warnings).toHaveLength(1);
  });
  it("rejects invented sources, quotes, duplicate fields and client-location evidence", () => {
    const item = {
      field: "services" as const,
      source: "https://andmktg.com/",
      value: "Web design",
      evidence: "We build websites.",
    };
    const pages = [
      {
        url: item.source,
        text: "We build websites. Our client in Denver grew 30%.",
      },
    ];
    expect(
      groundProfileSuggestions(
        [
          item,
          item,
          { ...item, field: "facts", source: "https://evil.com" },
          { ...item, field: "audience", evidence: "Made up text." },
          {
            ...item,
            field: "locations",
            evidence: "Our client in Denver grew 30%.",
          },
        ],
        pages,
      ),
    ).toEqual([item]);
  });
});
