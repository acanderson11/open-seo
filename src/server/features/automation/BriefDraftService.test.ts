import { z } from "zod";
import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({
  detail: vi.fn(),
  byRequest: vi.fn(),
  context: vi.fn(),
  start: vi.fn(),
}));
vi.mock("./BriefRepository", () => ({ BriefRepository: { detail: m.detail } }));
vi.mock("./AutomationRepository", () => ({
  AutomationRepository: { byRequest: m.byRequest },
}));
vi.mock("./AutomationService", () => ({
  contextSnapshot: m.context,
  startDraft: m.start,
  validateTarget: (url: string) => url,
}));
import { draftSavedBrief } from "./BriefDraftService";
const brief = () => ({
  id: "b1",
  state: "saved",
  action: "research_first",
  contextVersion: "v1",
  completedAt: new Date().toISOString(),
  topic: "Website redesign",
  title: "Redesign",
  angle: "Systems",
  rationale: "Improve lead handling",
  sources: [
    {
      id: "page1",
      kind: "page",
      url: "https://example.com/",
      content: "We build useful websites",
      observedAt: new Date().toISOString(),
    },
    {
      id: "serp1",
      kind: "serp",
      url: "https://competitor.com/",
      content: "Unverified statistics",
      observedAt: new Date().toISOString(),
    },
  ],
  sections: [
    {
      kind: "outline",
      heading: "Decide",
      detail: "Choose a useful intervention",
    },
    {
      kind: "finding",
      detail: "Websites",
      evidenceId: "page1",
      quote: "We build useful websites",
    },
    { kind: "gap", detail: "Coverage incomplete" },
  ],
});
beforeEach(() => {
  vi.resetAllMocks();
  m.byRequest.mockResolvedValue(null);
  m.context.mockResolvedValue({ version: "v1" });
  m.detail.mockResolvedValue(brief());
});
it("reuses an existing draft without spending again", async () => {
  m.byRequest.mockResolvedValue({ id: "job" });
  expect(await draftSavedBrief("p1", "example.com", "a", "b1")).toEqual({
    id: "job",
  });
  expect(m.start).not.toHaveBeenCalled();
});
it("rejects another project's missing brief, stale context and old evidence", async () => {
  for (const value of [
    null,
    { ...brief(), contextVersion: "v0" },
    { ...brief(), completedAt: "2020-01-01" },
  ]) {
    m.detail.mockResolvedValue(value);
    await expect(
      draftSavedBrief("p1", "example.com", "a", "b1"),
    ).rejects.toThrow();
  }
  expect(m.start).not.toHaveBeenCalled();
});
it("carries the saved outline and optional research guidance but excludes SERP snippets as article evidence", async () => {
  await draftSavedBrief("p1", "example.com", "a", "b1");
  const planned = z
    .object({
      kind: z.string(),
      savedBrief: z.object({
        sources: z.array(z.unknown()),
        guidance: z.string(),
        brief: z.object({ outline: z.array(z.string()) }),
      }),
    })
    .parse(m.start.mock.calls[0]?.[4]);
  expect(planned.savedBrief.guidance).toContain(
    "not requirements for drafting or approval",
  );
  expect(planned.savedBrief.sources).toHaveLength(1);
  expect(planned.savedBrief.brief.outline[0]).toContain(
    "Choose a useful intervention",
  );
  expect(planned.savedBrief.guidance).toContain("Coverage incomplete");
  expect(planned.kind).toBe("new_content");
});
