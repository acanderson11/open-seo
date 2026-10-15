import { beforeEach, it, expect, vi } from "vitest";
const m = vi.hoisted(() => ({ plan: vi.fn() }));
vi.mock("./ArticleGenerationService", () => ({ generateStage: m.plan }));
vi.mock("./ContentLearningRepository", () => ({
  ContentLearningRepository: {},
}));
vi.mock("./AutopilotRepository", () => ({ AutopilotRepository: {} }));
vi.mock("./AutomationRepository", () => ({ AutomationRepository: {} }));
vi.mock("./InventoryRepository", () => ({ InventoryRepository: {} }));
vi.mock("./InventoryService", () => ({
  seedInventory: vi.fn(),
  refreshInventoryBatch: vi.fn(),
}));
vi.mock("./AutomationService", () => ({
  contextSnapshot: vi.fn(),
  startDraft: vi.fn(),
  validateTarget: vi.fn(),
}));
vi.mock("./DraftReviewService", () => ({ notifyReviewer: vi.fn() }));
vi.mock("@/server/features/gsc/services/GscService", () => ({
  GscService: {},
}));
vi.mock("@/server/features/ga4/services/SearchOpportunityService", () => ({
  SearchOpportunityService: {},
}));
vi.mock(
  "@/server/features/project-context/services/ProjectContextService",
  () => ({ ProjectContextService: {} }),
);
vi.mock("@/server/features/projects/repositories/ProjectRepository", () => ({
  ProjectRepository: {},
}));
vi.mock("@/server/lib/runtime-env", () => ({
  isHostedServerAuthMode: async () => false,
}));
import { selectOpportunity } from "./AutopilotService";
const input: Parameters<typeof selectOpportunity>[0] = {
  projectId: "p1",
  domain: "example.com",
  context: "CRM services",
  contextVersion: "ctx",
  policyVersion: "policy",
  evidence: [
    {
      id: "business-targets",
      kind: "business_priority",
      data: "CRM implementation",
    },
  ],
  sources: [
    { url: "https://example.com/", title: "Example", text: "Example services" },
  ],
  existingPages: ["https://example.com/crm/"],
  pageInventory: [
    {
      url: "https://example.com/crm/",
      title: "CRM implementation",
      heading: "CRM implementation services",
      purpose: "Service / product",
      readAt: "2026-09-27",
    },
  ],
  recentTopics: [],
  dataCoverage: {
    gsc: "fulfilled",
    ga4: "fulfilled",
    inventoryTruncated: false,
    inventoryReadPages: 1,
  },
};
const proposal = (topic: string) => ({
  action: "draft",
  topic,
  rationale: "Business priority",
  evidenceIds: ["business-targets"],
  sourceUrls: ["https://example.com/"],
});
beforeEach(() => m.plan.mockResolvedValue(proposal("CRM implementation")));
it("holds a proposed article with strong existing-page overlap", async () => {
  const result = await selectOpportunity(input);
  expect(result.action).toBe("skip");
  if (result.action === "skip")
    expect(result.reason).toContain("https://example.com/crm/");
});
it("allows a distinct topic through existing evidence validation", async () => {
  m.plan.mockResolvedValue(
    proposal("Preparing customer records for migration"),
  );
  expect((await selectOpportunity(input)).action).toBe("draft");
});
