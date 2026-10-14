import { describe, it, expect } from "vitest";
import {
  draftState,
  renderArticle,
  automationResultSchema,
} from "./automation";
describe("execution artifact boundary", () => {
  it("holds poor quality and stale context even without human approval", () => {
    expect(draftState(false, "none", true)).toBe("needs_revision");
    expect(draftState(true, "none", false)).toBe("needs_revision");
    expect(draftState(true, "client", true)).toBe("awaiting_approval");
    expect(draftState(true, "none", true)).toBe("ready_for_manual_publication");
  });
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
