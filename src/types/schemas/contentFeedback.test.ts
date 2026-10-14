import { articlePassages, revisionMessage } from "./articlePassages";
import { it, expect } from "vitest";
import { feedbackFields, validateFeedback } from "./contentFeedback";
it("requires actionable revision feedback and explicit lasting instructions", () => {
  const blank = feedbackFields.parse({});
  expect(() => validateFeedback("changes_requested", blank)).toThrow();
  expect(() =>
    validateFeedback("changes_requested", {
      ...blank,
      message: "Make it clearer",
      scope: "preference",
    }),
  ).toThrow();
  expect(
    validateFeedback("changes_requested", {
      ...blank,
      message: "Use a comparison here",
    }).scope,
  ).toBe("article");
  expect(() =>
    validateFeedback("approved", { ...blank, message: "Still incorrect" }),
  ).toThrow();
  expect(() =>
    validateFeedback("changes_requested", {
      ...blank,
      message: "Change this",
      scope: "preference",
      category: "facts",
      instruction: "New fact",
    }),
  ).toThrow();
});

it("anchors decoded passages without changing export HTML and rejects mismatched anchors", () => {
  const html =
    "<h2>Useful heading</h2><p>A <strong>clear</strong> &amp; useful example.</p><ul><li>One</li><li>Two</li></ul>";
  const blocks = articlePassages(html);
  expect(blocks).toHaveLength(3);
  expect(blocks.map((b) => b.html).join("")).toBe(html);
  expect(blocks[1]?.quote).toBe("A clear & useful example.");
  const feedback = feedbackFields.parse({
    passages: [
      { blockIndex: 1, quote: blocks[1].quote, message: "Add a source." },
    ],
  });
  expect(validateFeedback("changes_requested", feedback, html).message).toBe(
    "",
  );
  expect(revisionMessage("", feedback.passages)).toContain(
    "Requested change: Add a source.",
  );
  expect(() => validateFeedback("approved", feedback, html)).toThrow();
  expect(() =>
    validateFeedback("changes_requested", feedback, "<p>Changed</p>"),
  ).toThrow();
  expect(() =>
    validateFeedback(
      "changes_requested",
      { ...feedback, passages: [...feedback.passages!, ...feedback.passages!] },
      html,
    ),
  ).toThrow();
  expect(() =>
    validateFeedback(
      "changes_requested",
      { ...feedback, message: "x".repeat(4000) },
      html,
    ),
  ).toThrow();
});
