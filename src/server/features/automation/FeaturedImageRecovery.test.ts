import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({
  job: vi.fn(),
  preferences: vi.fn(),
  begin: vi.fn(),
  provider: vi.fn(),
  recordProviderResult: vi.fn(),
  normalize: vi.fn(),
  caption: vi.fn(),
  fail: vi.fn(),
  image: vi.fn(),
  select: vi.fn(),
  clone: vi.fn(),
  selected: vi.fn(),
}));
vi.mock("./AutomationRepository", () => ({
  AutomationRepository: { job: m.job },
}));
vi.mock("./ProjectImageRepository", () => ({
  ProjectImageRepository: { preferences: m.preferences },
}));
vi.mock("./FeaturedImageRepository", () => ({
  FeaturedImageRepository: {
    begin: m.begin,
    recordProviderResult: m.recordProviderResult,
    fail: m.fail,
    image: m.image,
    select: m.select,
    cloneReadyForVersion: m.clone,
    selected: m.selected,
  },
}));
vi.mock("./FeaturedImageCodec", () => ({
  normalizeFeaturedImage: m.normalize,
}));
vi.mock("./OpenRouterImage", () => ({
  IMAGE_PROMPT_LIMIT: 5000,
  generateConceptualImage: m.provider,
}));
vi.mock("./OpenRouterImageCaption", () => ({
  captionConceptualImage: m.caption,
}));
import {
  prepareFeaturedImage,
  reuseFeaturedImage,
} from "./FeaturedImageService";
const job = {
  version: 4,
  state: "awaiting_approval",
  bodyHtml: "<p>Software expenses.</p>",
  title: "Software expenses",
  topic: "Software consolidation",
  featuredImageId: "old-image",
  wordpressPostId: null,
  publishedUrl: null,
};
beforeEach(() => {
  vi.clearAllMocks();
  m.job.mockResolvedValue({ ...job });
  m.preferences.mockResolvedValue({
    autoGenerate: 0,
    style: "Realistic photograph",
  });
  m.begin.mockResolvedValue(true);
  m.provider.mockResolvedValue({
    bytes: new Uint8Array([1]),
    model: "example/image",
    costUsd: "0.01",
  });
  m.recordProviderResult.mockResolvedValue(true);
  m.normalize.mockResolvedValue({ bytes: new Uint8Array([1]) });
  m.caption.mockResolvedValue({
    alt: "A monitor with invented labels.",
    forbidden: true,
    reason: "Visible letters on the monitor.",
  });
  m.image.mockResolvedValue({ id: "reused-image", status: "ready" });
  m.clone.mockResolvedValue("reused-image");
  m.select.mockResolvedValue(true);
  m.selected.mockResolvedValue({ id: "old-image", status: "ready" });
});

it("does not regenerate an already selected image even when automatic images are enabled", async () => {
  m.preferences.mockResolvedValue({ autoGenerate: 1 });
  expect(
    await prepareFeaturedImage(
      { projectId: "p1", jobId: "j1", version: 4 },
      "system:image",
    ),
  ).toEqual({
    id: "old-image",
    status: "ready",
  });
  expect(m.provider).not.toHaveBeenCalled();
  expect(m.begin).not.toHaveBeenCalled();
});

it("uses an explicit visual brief rather than replacing it with the default scene", async () => {
  await prepareFeaturedImage(
    { projectId: "p1", jobId: "j1", version: 4 },
    "agency",
    {
      visualBrief: "Two unmarked wooden boxes beside a window.",
      force: true,
    },
  );
  expect(m.provider.mock.calls[0][0]).toContain(
    "Visual direction: Two unmarked wooden boxes beside a window.",
  );
  expect(m.provider.mock.calls[0][0]).not.toContain("loosely tangled cables");
});

it("a rejected replacement never selects a failed image or changes the article's current selection", async () => {
  await prepareFeaturedImage(
    { projectId: "p1", jobId: "j1", version: 4 },
    "agency",
    { force: true },
  );
  expect(m.provider).toHaveBeenCalledTimes(1);
  expect(m.select).not.toHaveBeenCalled();
  expect(m.clone).not.toHaveBeenCalled();
  expect(m.fail).toHaveBeenCalledWith(
    "p1",
    expect.any(String),
    expect.stringContaining("Visible letters on the monitor."),
  );
  expect(await m.job()).toMatchObject({ featuredImageId: "old-image" });
  expect(m.provider.mock.calls[0][0]).toContain(
    "following the requested visual style",
  );
  expect(m.provider.mock.calls[0][0]).toContain("Style: Realistic photograph");
});

it("restores a prior image without provider or processing calls", async () => {
  await reuseFeaturedImage("p1", "j1", 4, "prior-image", "agency");
  expect(m.clone).toHaveBeenCalledWith("p1", "j1", "prior-image", 4, "agency");
  expect(m.select).toHaveBeenCalledWith(
    { projectId: "p1", jobId: "j1", version: 4 },
    "reused-image",
    "agency",
  );
  expect(m.provider).not.toHaveBeenCalled();
  expect(m.normalize).not.toHaveBeenCalled();
});

it.each([
  { version: 3 },
  { wordpressPostId: 17 },
  { publishedUrl: "https://example.com/post" },
  { state: "publishing" },
])("does not restore to a stale or published article: %j", async (change) => {
  m.job.mockResolvedValue({ ...job, ...change });
  await expect(
    reuseFeaturedImage("p1", "j1", 4, "prior-image", "agency"),
  ).rejects.toThrow();
  expect(m.clone).not.toHaveBeenCalled();
  expect(m.select).not.toHaveBeenCalled();
});

it("does not select a source rejected by the scoped ready-image clone", async () => {
  m.clone.mockResolvedValue(null);
  await expect(
    reuseFeaturedImage("p1", "j1", 4, "prior-image", "agency"),
  ).rejects.toThrow();
  expect(m.select).not.toHaveBeenCalled();
});

it("marks an unselected clone failed if the draft changed before guarded selection", async () => {
  m.select.mockResolvedValue(false);
  await expect(
    reuseFeaturedImage("p1", "j1", 4, "prior-image", "agency"),
  ).rejects.toThrow();
  expect(m.fail).toHaveBeenCalledWith(
    "p1",
    "reused-image",
    expect.stringContaining("Draft changed"),
  );
  expect(m.provider).not.toHaveBeenCalled();
});
