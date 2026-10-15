import { it, expect, vi } from "vitest";
import { Script } from "node:vm";
vi.mock("./DraftReviewService", () => ({
  loadPrivateReview: vi.fn(),
  decidePrivateReview: vi.fn(),
}));
vi.mock("./FeaturedImageService", () => ({ featuredImageData: vi.fn() }));
vi.mock("./ArticleRevisionService", () => ({ startQueuedRevision: vi.fn() }));
import { handlePrivateReview } from "./privateReview";
it("serves syntactically valid client review controls with passage feedback", async () => {
  const response = await handlePrivateReview(
    new Request("https://example.com/review"),
  );
  const html = await response.text();
  const script = html.match(/<script[^>]*>([\s\S]*?)<\/script>/)?.[1];
  expect(script).toContain("showPassages(data.passages)");
  expect(() => new Script(script!)).not.toThrow();
  expect(response.headers.get("content-security-policy")).toContain(
    "default-src 'none'",
  );
});
