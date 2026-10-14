import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({
  byRequest: vi.fn(),
  countToday: vi.fn(),
  reserve: vi.fn(),
  finish: vi.fn(),
  get: vi.fn(),
  evidence: vi.fn(),
  model: vi.fn(),
  generate: vi.fn(),
  context: vi.fn(),
}));
vi.mock("./BriefRepository", () => ({ BriefRepository: m }));
vi.mock("./BriefEvidence", () => ({ collectBriefEvidence: m.evidence }));
vi.mock("./AutomationService", () => ({ contextSnapshot: m.context }));
vi.mock("@/server/lib/openrouter", () => ({ getChatAgentModel: m.model }));
vi.mock("ai", () => ({
  generateText: m.generate,
  Output: { object: vi.fn() },
}));
import { investigateBrief } from "./BriefService";
const input = {
  projectId: "p1",
  requestKey: "00000000-0000-4000-8000-000000000001",
  topic: "Website redesign",
  includeSerp: false,
};
const billing = {
  organizationId: "org",
  userId: "admin",
  userEmail: "admin@example.com",
};
const source = {
  id: "e0",
  kind: "page",
  title: "Service",
  url: "https://example.com/",
  content: "We design websites for local businesses.",
  observedAt: "2026-09-27",
};
beforeEach(() => {
  vi.resetAllMocks();
  m.byRequest.mockResolvedValue(null);
  m.countToday.mockResolvedValue(0);
  m.reserve.mockResolvedValue({ id: "brief" });
  m.evidence.mockResolvedValue({
    contextVersion: "v1",
    contextText: "Context",
    evidenceVersion: "ev1",
    sources: [source],
    warnings: [],
    coverageIncomplete: false,
  });
  m.context.mockResolvedValue({ version: "v1" });
  m.model.mockResolvedValue({ modelId: "test" });
  m.generate.mockResolvedValue({
    output: {
      title: "Redesign service",
      action: "improve_existing",
      targetEvidenceId: "e0",
      audience: "Local owners",
      intent: "Consider redesign",
      angle: "Business outcomes",
      rationale: "Service match",
      successMeasure: "Qualified leads",
      confidence: "medium",
      findings: [
        {
          detail: "Service relevance",
          evidenceId: "e0",
          quote: "design websites for local businesses",
        },
      ],
      outline: [],
      gaps: [],
      expertQuestions: [],
    },
  });
});
it("does not spend again when a completed request is replayed", async () => {
  m.byRequest.mockResolvedValue({
    id: "existing",
    topic: input.topic,
    includeSerp: 0,
  });
  expect((await investigateBrief("p1", "admin", input, billing))?.id).toBe(
    "existing",
  );
  expect(m.evidence).not.toHaveBeenCalled();
  expect(m.generate).not.toHaveBeenCalled();
});
it("stops before providers when the daily limit is reached", async () => {
  m.countToday.mockResolvedValue(20);
  await expect(
    investigateBrief("p1", "admin", input, billing),
  ).rejects.toThrow();
  expect(m.generate).not.toHaveBeenCalled();
});
it("saves source evidence with a warning when project guidance changes", async () => {
  m.context.mockResolvedValue({ version: "v2" });
  await investigateBrief("p1", "admin", input, billing);
  expect(m.finish).toHaveBeenCalledWith(
    "p1",
    "brief",
    expect.objectContaining({
      state: "saved",
      contextVersion: "v1",
      message:
        "Project context changed during investigation. Review against current guidance before using this brief.",
    }),
    [expect.objectContaining({ id: "e0", briefId: "brief" })],
    [expect.objectContaining({ kind: "finding", evidenceId: "e0" })],
  );
});
it("fails invalid citations without saving the proposal or exposing provider data", async () => {
  m.generate.mockResolvedValue({
    output: { secret: "private provider payload" },
  });
  await investigateBrief("p1", "admin", input, billing);
  expect(m.finish).toHaveBeenCalledWith(
    "p1",
    "brief",
    expect.objectContaining({ state: "failed" }),
    [],
    [],
  );
  expect(JSON.stringify(m.finish.mock.calls)).not.toContain(
    "private provider payload",
  );
});

it("distinguishes provider failure from rejected citations without exposing payloads", async () => {
  m.generate.mockRejectedValue(new Error("private provider details"));
  await investigateBrief("p1", "admin", input, billing);
  expect(m.finish).toHaveBeenCalledWith(
    "p1",
    "brief",
    {
      state: "failed",
      message:
        "The AI provider failed or did not return a valid structured brief. No brief was saved. Check model availability and structured-output support.",
    },
    [],
    [],
  );
  expect(JSON.stringify(m.finish.mock.calls)).not.toContain(
    "private provider details",
  );
});
it("reports evidence collection failure before calling the model", async () => {
  m.evidence.mockRejectedValue(new Error("private source"));
  await investigateBrief("p1", "admin", input, billing);
  expect(m.generate).not.toHaveBeenCalled();
  expect(m.finish).toHaveBeenCalledWith(
    "p1",
    "brief",
    {
      state: "failed",
      message:
        "Could not gather the project evidence. Check project context and connected data before retrying.",
    },
    [],
    [],
  );
});
