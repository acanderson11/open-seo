import { describe, it, expect } from "vitest";
import { renderArticle, articleDraftSchema } from "./automation";
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
});
