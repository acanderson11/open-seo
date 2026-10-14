import { describe, it, expect } from "vitest";
import { renderArticle, automationResultSchema } from "./automation";
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
  it("rejects arbitrary HTML and publication claims from the workflow", () => {
    expect(
      automationResultSchema.safeParse({
        publicationPerformed: true,
        draft: { html: "<script>bad()</script>" },
      }).success,
    ).toBe(false);
  });
});
