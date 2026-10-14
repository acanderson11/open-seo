import { beforeEach, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  job: vi.fn(),
  policy: vi.fn(),
  approve: vi.fn(),
  wordpress: vi.fn(),
}));
vi.mock("./AutomationRepository", () => ({
  AutomationRepository: { job: m.job, policy: m.policy, approve: m.approve },
}));
vi.mock("./AutopilotRepository", () => ({
  AutopilotRepository: { wordpress: m.wordpress },
}));
vi.mock("./FeaturedImageRepository", () => ({
  FeaturedImageRepository: { image: vi.fn() },
}));
vi.mock("./AutomationResult", () => ({ boundedJson: vi.fn() }));
vi.mock("@/server/lib/runtime-env", () => ({
  getOptionalEnvValue: vi.fn(),
}));

import { decideDraft } from "./DraftReviewService";

const approve = () =>
  decideDraft("p1", "j1", "agency-user", "approved", {
    version: 2,
    featuredImageId: null,
  });

beforeEach(() => {
  m.job.mockResolvedValue({
    id: "j1",
    state: "awaiting_approval",
    version: 2,
    kind: "new_content",
    qualityPassed: 1,
    bodyHtml: "<p>Article</p>",
    featuredImageId: null,
    // Drafted under older Context and settings than the project has now.
    contextVersion: "old-context",
    policyVersion: "old-policy",
  });
  m.policy.mockResolvedValue({
    enabled: 1,
    version: "current-policy",
    approval: "agency",
    delivery: "wordpress",
  });
  m.wordpress.mockResolvedValue({ version: "wp-connection-1" });
  m.approve.mockResolvedValue(true);
});

it("queues a new article for WordPress when the project delivers there, even without autopilot", async () => {
  await approve();
  expect(m.approve.mock.lastCall?.[4]).toMatchObject({
    state: "ready_to_publish",
    wordpressVersion: "wp-connection-1",
  });
});

it("keeps refreshes of existing pages and unconnected projects manual", async () => {
  m.job.mockResolvedValue({ ...(await m.job()), kind: "refresh_content" });
  await approve();
  expect(m.approve.mock.lastCall?.[4]).toMatchObject({
    state: "ready_for_manual_publication",
    wordpressVersion: null,
  });

  m.job.mockResolvedValue({ ...(await m.job()), kind: "new_content" });
  m.wordpress.mockResolvedValue(null);
  await approve();
  expect(m.approve.mock.lastCall?.[4]).toMatchObject({
    state: "ready_for_manual_publication",
  });
});

it("does not let an agency decision satisfy required client approval", async () => {
  m.policy.mockResolvedValue({ ...(await m.policy()), approval: "client" });
  await expect(approve()).rejects.toThrow("FORBIDDEN");
  expect(m.approve).not.toHaveBeenCalled();
});
