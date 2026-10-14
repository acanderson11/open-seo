import { afterEach, beforeEach, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  job: vi.fn(),
  preferences: vi.fn(),
  asset: vi.fn(),
  begin: vi.fn(),
  provider: vi.fn(),
  recordProviderResult: vi.fn(),
  normalize: vi.fn(),
  fail: vi.fn(),
  image: vi.fn(),
  caption: vi.fn(),
}));
vi.mock("./AutomationRepository", () => ({
  AutomationRepository: { job: m.job },
}));
vi.mock("./FeaturedImageRepository", () => ({
  FeaturedImageRepository: {
    preferences: m.preferences,
    asset: m.asset,
    begin: m.begin,
    recordProviderResult: m.recordProviderResult,
    fail: m.fail,
    image: m.image,
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
import { prepareFeaturedImage } from "./FeaturedImageService";

beforeEach(() => {
  vi.clearAllMocks();
  m.job.mockResolvedValue({
    version: 2,
    state: "awaiting_approval",
    bodyHtml: "<p>An article on software overlap.</p>",
    title: "Software overlap",
    topic: "subscription consolidation",
    featuredImageId: null,
    wordpressPostId: null,
    publishedUrl: null,
  });
  m.preferences.mockResolvedValue(null);
  m.begin.mockResolvedValue(true);
  m.provider.mockResolvedValue({
    bytes: new Uint8Array([1, 2, 3]),
    model: "recraft/recraft-v4.1-flash",
    costUsd: "0.007",
  });
  m.recordProviderResult.mockResolvedValue(true);
  m.normalize.mockRejectedValue(new TypeError("private source image bytes"));
  m.image.mockResolvedValue({ status: "failed" });
});
afterEach(() => vi.unstubAllGlobals());

it.each([1, 2])("does not create an automatic image for version %i without opt-in", async (version) => {
  m.job.mockResolvedValue({ ...await m.job(), version });
  expect(await prepareFeaturedImage("p1", "j1", version, "system:image")).toBeNull();
  expect(m.begin).not.toHaveBeenCalled();
  expect(m.asset).not.toHaveBeenCalled();
  expect(m.provider).not.toHaveBeenCalled();
  expect(m.caption).not.toHaveBeenCalled();
});

it("does not apply a preferred library image when automatic images are off", async () => {
  m.preferences.mockResolvedValue({ autoGenerate: 0, preferredAssetId: "asset-1" });
  expect(await prepareFeaturedImage("p1", "j1", 2, "system:image")).toBeNull();
  expect(m.asset).not.toHaveBeenCalled();
  expect(m.begin).not.toHaveBeenCalled();
  expect(m.provider).not.toHaveBeenCalled();
});

it("starts automatic image generation after the project opts in", async () => {
  m.preferences.mockResolvedValue({ autoGenerate: 1, preferredAssetId: null });
  await prepareFeaturedImage("p1", "j1", 2, "system:image");
  expect(m.begin).toHaveBeenCalledWith(expect.objectContaining({ status: "generating" }));
  expect(m.provider).toHaveBeenCalledTimes(1);
});

it("keeps provider model and cost when WebP normalization fails, with a safe stage label", async () => {
  await prepareFeaturedImage("p1", "j1", 2, "agency", "", "", false, true);
  expect(m.provider).toHaveBeenCalledTimes(1);
  expect(m.recordProviderResult).toHaveBeenCalledWith(
    "p1",
    expect.any(String),
    "recraft/recraft-v4.1-flash",
    "0.007",
  );
  expect(m.fail).toHaveBeenCalledWith(
    "p1",
    expect.any(String),
    "Image source inspection or WebP conversion failed.",
  );
  expect(JSON.stringify(m.fail.mock.calls)).not.toContain(
    "private source image bytes",
  );
});
