import { beforeEach, it, expect, vi } from "vitest";
const m = vi.hoisted(() => ({ detail: vi.fn(), pages: vi.fn() }));
vi.mock("./BriefRepository", () => ({ BriefRepository: { detail: m.detail } }));
vi.mock("./AutomationService", () => ({
  validateTarget: (s: string, domain: string) => {
    const url = new URL(s);
    if (url.protocol !== "https:" || url.hostname !== domain)
      throw new Error("VALIDATION_ERROR");
    return url.href;
  },
}));
vi.mock("@/server/lib/scrape", () => ({ readPages: m.pages }));
import { revisionSources } from "./RevisionSources";
beforeEach(() => {
  vi.resetAllMocks();
  m.pages.mockResolvedValue({
    pages: [{ url: "https://example.com", text: "Fresh source" }],
  });
});
it("uses saved page evidence, not SERP snippets, without re-scraping", async () => {
  m.detail.mockResolvedValue({
    sources: [
      {
        kind: "page",
        url: "https://example.com",
        content: "Saved source",
        observedAt: new Date().toISOString(),
      },
      {
        kind: "serp",
        url: "https://example.org",
        content: "Snippet",
        observedAt: new Date().toISOString(),
      },
    ],
  });
  expect(
    (await revisionSources("p", "b", "https://example.com", "example.com"))
      .pages,
  ).toEqual([{ url: "https://example.com/", text: "Saved source" }]);
  expect(m.pages).not.toHaveBeenCalled();
});
it("prefers a fresh read to older saved evidence", async () => {
  m.detail.mockResolvedValue({
    sources: [
      {
        kind: "page",
        url: "https://example.com",
        content: "Old",
        observedAt: "2020-01-01",
      },
    ],
  });
  expect(
    (await revisionSources("p", "b", "https://example.com", "example.com"))
      .pages[0].text,
  ).toBe("Fresh source");
  expect(m.pages).toHaveBeenCalledOnce();
});
it("uses dated site evidence if a fresh read is blocked", async () => {
  m.detail.mockResolvedValue({
    sources: [
      {
        kind: "page",
        url: "https://example.com/services",
        content: "Saved service information",
        observedAt: "2025-01-01T12:00:00.000Z",
      },
    ],
  });
  m.pages.mockResolvedValue({ pages: [], blocked: true });
  const result = await revisionSources(
    "p",
    "b",
    "https://example.com/",
    "example.com",
  );
  expect(result.pages).toHaveLength(1);
  expect(result.pages[0]?.url).toBe("https://example.com/services");
  expect(result.pages[0]?.text).toContain(
    "Historical site page captured 2025-01-01T12:00:00.000Z",
  );
  expect(result.pages[0].text).toContain("Saved service information");
  expect(result.warning).toContain("verify current business facts");
  expect(m.pages).toHaveBeenCalledOnce();
});
it("rejects saved pages outside the project's site", async () => {
  m.detail.mockResolvedValue({
    sources: [
      {
        kind: "page",
        url: "https://other.example/services",
        content: "Unsupported source",
        observedAt: "2025-01-01T12:00:00.000Z",
      },
    ],
  });
  m.pages.mockResolvedValue({ pages: [], blocked: true });
  const result = await revisionSources(
    "p",
    "b",
    "https://example.com/",
    "example.com",
  );
  expect(result.pages).toEqual([]);
  expect(result.warning).toBeNull();
});
