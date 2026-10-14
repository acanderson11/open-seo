import { beforeEach, afterEach, it, expect, vi } from "vitest";
import { dueForDraft } from "@/types/schemas/autopilot";
const m = vi.hoisted(() => ({
  claim: vi.fn(),
  job: vi.fn(),
  policy: vi.fn(),
  wordpress: vi.fn(),
  update: vi.fn(),
  context: vi.fn(),
  project: vi.fn(),
  link: vi.fn(),
  approve: vi.fn(),
  used: vi.fn(),
  image: vi.fn(),
  setMedia: vi.fn(),
  imageBytes: vi.fn(),
}));
vi.mock("./AutopilotRepository", () => ({
  AutopilotRepository: {
    claimPublication: m.claim,
    wordpress: m.wordpress,
    link: m.link,
    useLink: m.used,
  },
}));
vi.mock("./AutomationRepository", () => ({
  AutomationRepository: {
    job: m.job,
    policy: m.policy,
    update: m.update,
    approve: m.approve,
  },
}));
vi.mock("./AutomationService", () => ({
  contextSnapshot: m.context,
  validateTarget: (url: string) => url,
}));
vi.mock("@/server/features/projects/repositories/ProjectRepository", () => ({
  ProjectRepository: { getProjectById: m.project },
}));
vi.mock("@/server/lib/audit/url-policy", () => ({
  normalizeAndValidateStartUrl: async (url: string) => url,
}));
vi.mock("@/lib/auth", () => ({
  getAuth: () => ({ $context: Promise.resolve({ secretConfig: "fixture" }) }),
}));
vi.mock("better-auth/crypto", () => ({
  symmetricDecrypt: async () => "fixture",
  symmetricEncrypt: async () => "encrypted-fixture",
}));
vi.mock("@/server/lib/runtime-env", () => ({
  getOptionalEnvValue: async () => "https://review.andmktg.com",
}));
vi.mock("./FeaturedImageRepository", () => ({
  FeaturedImageRepository: { image: m.image, setWordpressMedia: m.setMedia },
}));
vi.mock("./FeaturedImageCodec", () => ({ readFeaturedImage: m.imageBytes }));
import { publishApprovedDraft } from "./WordpressPublication";
import { loadPrivateReview, decidePrivateReview } from "./DraftReviewService";
beforeEach(() => {
  vi.resetAllMocks();
  m.claim.mockResolvedValue(true);
  m.project.mockResolvedValue({ domain: "example.com" });
  m.context.mockResolvedValue({ version: "ctx1" });
  m.wordpress.mockResolvedValue({
    version: "wp1",
    baseUrl: "https://example.com",
    username: "fixture",
    passwordCipher: "cipher",
  });
  m.policy.mockResolvedValue({
    enabled: 1,
    autopilot: 1,
    delivery: "wordpress",
    version: "policy1",
    approval: "client",
    reviewerEmail: "reviewer@example.com",
  });
  m.job.mockResolvedValue({
    id: "j1",
    projectId: "p1",
    version: 1,
    state: "awaiting_approval",
    kind: "new_content",
    qualityPassed: 1,
    bodyHtml: "<p>Verified draft</p>",
    contextVersion: "ctx1",
    policyVersion: "policy1",
    wordpressVersion: "wp1",
    title: "Fixture article",
    topic: "Fixture article",
  });
  m.link.mockResolvedValue({
    projectId: "p1",
    jobId: "j1",
    artifactVersion: 1,
    role: "client",
    recipient: "reviewer@example.com",
    expiresAt: new Date(Date.now() + 100000).toISOString(),
    usedAt: null,
  });
  m.approve.mockResolvedValue(true);
  m.setMedia.mockResolvedValue(true);
});
afterEach(() => vi.unstubAllGlobals());
it("paces a four-article target across the calendar month", () => {
  expect(dueForDraft(4, 0, new Date("2026-09-01T12:00:00Z"))).toBe(true);
  expect(dueForDraft(4, 1, new Date("2026-09-01T12:00:00Z"))).toBe(false);
  expect(dueForDraft(4, 1, new Date("2026-09-09T12:00:00Z"))).toBe(true);
  expect(dueForDraft(4, 4, new Date("2026-09-30T12:00:00Z"))).toBe(false);
});
it("does not send a WordPress request when publication is already claimed", async () => {
  m.claim.mockResolvedValue(false);
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  await publishApprovedDraft("p1", "j1");
  expect(fetch).not.toHaveBeenCalled();
});
it("blocks publishing when Context or connection version changed", async () => {
  m.context.mockResolvedValue({ version: "changed" });
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  await publishApprovedDraft("p1", "j1");
  expect(fetch).not.toHaveBeenCalled();
  expect(m.update).toHaveBeenCalledWith(
    "p1",
    "j1",
    expect.objectContaining({ state: "publication_blocked" }),
  );
});
it("creates a WordPress draft then publishes that exact id", async () => {
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(
      Response.json({
        id: 7,
        link: "https://example.com/?p=7",
        slug: "fixture",
        status: "draft",
      }),
    )
    .mockResolvedValueOnce(
      Response.json({
        id: 7,
        link: "https://example.com/fixture",
        slug: "fixture",
        status: "publish",
      }),
    );
  vi.stubGlobal("fetch", fetch);
  await publishApprovedDraft("p1", "j1");
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(fetch.mock.calls[0]?.[1]?.headers["user-agent"]).toBe("OpenSEO");
  expect(fetch.mock.calls[1]?.[0]).toBe(
    "https://example.com/wp-json/wp/v2/posts/7",
  );
  expect(m.update).toHaveBeenCalledWith("p1", "j1", { wordpressPostId: 7 });
  expect(m.update).toHaveBeenCalledWith(
    "p1",
    "j1",
    expect.objectContaining({ state: "published" }),
  );
});
it("uploads the reviewed WebP before the post and attaches the persisted media id", async () => {
  m.job.mockResolvedValue({ ...(await m.job()), featuredImageId: "img1" });
  m.image.mockResolvedValue({
    id: "img1",
    jobId: "j1",
    artifactVersion: 1,
    status: "ready",
    r2Key: "image.webp",
    altText: "An editorial illustration of overlapping business tools",
    wordpressMediaId: null,
  });
  m.imageBytes.mockResolvedValue(new Uint8Array([82, 73, 70, 70]));
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(Response.json({ id: 9 }))
    .mockResolvedValueOnce(Response.json({ id: 9 }))
    .mockResolvedValueOnce(
      Response.json({
        id: 7,
        link: "https://example.com/?p=7",
        slug: "fixture",
        status: "draft",
      }),
    )
    .mockResolvedValueOnce(
      Response.json({
        id: 7,
        link: "https://example.com/fixture",
        slug: "fixture",
        status: "publish",
      }),
    );
  vi.stubGlobal("fetch", fetch);
  await publishApprovedDraft("p1", "j1");
  expect(fetch.mock.calls[0]?.[0]).toBe(
    "https://example.com/wp-json/wp/v2/media",
  );
  expect(fetch.mock.calls[0]?.[1]?.headers["user-agent"]).toBe("OpenSEO");
  expect(m.setMedia).toHaveBeenCalledWith("p1", "img1", 9);
  expect(JSON.parse(fetch.mock.calls[2]?.[1]?.body as string)).toMatchObject({
    featured_media: 9,
  });
  expect(m.update).toHaveBeenCalledWith(
    "p1",
    "j1",
    expect.objectContaining({ state: "published" }),
  );
});
it("holds an unknown WordPress outcome without repeating a write", async () => {
  const fetch = vi.fn().mockRejectedValue(new Error("timeout"));
  vi.stubGlobal("fetch", fetch);
  await publishApprovedDraft("p1", "j1");
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(m.update).toHaveBeenCalledWith(
    "p1",
    "j1",
    expect.objectContaining({ state: "publication_unknown" }),
  );
});
it("private review cannot use an expired or already-used token", async () => {
  m.link
    .mockResolvedValueOnce({ expiresAt: "2000-01-01", usedAt: null })
    .mockResolvedValueOnce({ expiresAt: "2100-01-01", usedAt: "2026-09-26" });
  await expect(loadPrivateReview("a".repeat(72))).rejects.toThrow();
  await expect(loadPrivateReview("a".repeat(72))).rejects.toThrow();
});
it("private review rejects changed role, recipient and Context", async () => {
  m.policy.mockResolvedValueOnce({
    enabled: 1,
    autopilot: 1,
    delivery: "wordpress",
    version: "policy1",
    approval: "agency",
    reviewerEmail: "reviewer@example.com",
  });
  await expect(loadPrivateReview("a".repeat(72))).rejects.toThrow();
  m.context.mockResolvedValue({ version: "changed" });
  await expect(loadPrivateReview("a".repeat(72))).rejects.toThrow();
  expect(m.approve).not.toHaveBeenCalled();
});
it("records a client decision only for the server-bound job and consumes link", async () => {
  await decidePrivateReview("a".repeat(72), "approved");
  expect(m.approve).toHaveBeenCalledWith(
    "p1",
    "j1",
    expect.stringContaining("private-link:"),
    "approved",
    {
      state: "ready_for_manual_publication",
      role: "client",
      artifactVersion: 1,
      feedback: expect.objectContaining({ message: "", scope: "article" }),
    },
  );
  expect(m.used).toHaveBeenCalledTimes(1);
});

it("rejects a private link for an older artifact version", async () => {
  m.job.mockResolvedValue({ ...(await m.job()), version: 2 });
  await expect(loadPrivateReview("a".repeat(72))).rejects.toThrow();
  expect(m.approve).not.toHaveBeenCalled();
});
it("requires feedback for client change requests and binds it to the link revision", async () => {
  await expect(
    decidePrivateReview("a".repeat(72), "changes_requested"),
  ).rejects.toThrow();
  const feedback = {
    message: "Explain the example",
    scope: "article" as const,
    category: "voice" as const,
    instruction: "",
  };
  await decidePrivateReview("a".repeat(72), "changes_requested", feedback);
  expect(m.approve).toHaveBeenCalledWith(
    "p1",
    "j1",
    expect.any(String),
    "changes_requested",
    { state: "revision_queued", role: "client", artifactVersion: 1, feedback },
  );
});

it("approves manual delivery without a WordPress connection or publishing request", async () => {
  m.policy.mockResolvedValue({ ...(await m.policy()), delivery: "manual" });
  m.job.mockResolvedValue({ ...(await m.job()), wordpressVersion: null });
  m.wordpress.mockResolvedValue(null);
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  expect((await loadPrivateReview("a".repeat(72))).delivery).toBe("manual");
  const result = await decidePrivateReview("a".repeat(72), "approved");
  expect(result.message).toContain("manual copy/paste");
  expect(m.approve).toHaveBeenCalled();
  expect(fetch).not.toHaveBeenCalled();
});
it("blocks WordPress writes when the delivery mode is manual even with saved credentials", async () => {
  m.policy.mockResolvedValue({ ...(await m.policy()), delivery: "manual" });
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  await publishApprovedDraft("p1", "j1");
  expect(fetch).not.toHaveBeenCalled();
});
