import { describe, it, expect } from "vitest";
import { z } from "zod";
import {
  renderArticle,
  articleBriefSchema,
  articleDraftSchema,
  articleReviewSchema,
} from "./automation";
import { plannerSelection } from "./autopilot";
/** True when some JSON Schema array has maxItems and union (anyOf) items. */
const capped = (node: unknown): boolean =>
  !!node &&
  typeof node === "object" &&
  (("maxItems" in node &&
    "items" in node &&
    !!node.items &&
    typeof node.items === "object" &&
    "anyOf" in node.items) ||
    Object.values(node).some(capped));
describe("execution artifact boundary", () => {
  it("renders only supported markup and escapes executable content", () => {
    expect(
      renderArticle({
        title: "Title",
        metaDescription: "Description",
        blocks: [
          { type: "paragraph", text: '<img src=x onerror="alert(1)">' },
          { type: "ul", items: ["a & b"] },
        ],
      }),
    ).toBe(
      "<p>&lt;img src=x onerror=&quot;alert(1)&quot;&gt;</p>\n<ul><li>a &amp; b</li></ul>",
    );
  });
  it("accepts model output only as structured blocks, never raw HTML", () => {
    expect(
      articleDraftSchema.safeParse({
        title: "Title",
        metaDescription: "Description",
        html: "<script>bad()</script>",
      }).success,
    ).toBe(false);
  });
  it("sends the model no array cap over union items, which Gemini rejects", () => {
    for (const schema of [
      articleBriefSchema,
      articleDraftSchema,
      articleReviewSchema,
      plannerSelection,
    ])
      expect(capped(z.toJSONSchema(schema))).toBe(false);
  });
  it("still refuses an article with more than 100 blocks", () => {
    const blocks = Array.from({ length: 101 }, () => ({
      type: "paragraph" as const,
      text: "Text",
    }));
    expect(
      articleDraftSchema.safeParse({ title: "T", metaDescription: "D", blocks })
        .success,
    ).toBe(false);
  });
});
