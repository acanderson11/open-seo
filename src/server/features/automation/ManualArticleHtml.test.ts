import { expect, it } from "vitest";
import { sanitizeManualArticleHtml } from "./ManualArticleHtml";

const valid =
  "<h2>One</h2><p>" +
  "A useful article about software subscriptions and their operational costs. ".repeat(
    8,
  ) +
  '<a href="https://andmktg.com/the-audit/">Audit</a></p><p>Three</p>';

it("keeps supported content and safe links", () => {
  const html = sanitizeManualArticleHtml(valid);
  expect(html).toContain('<a href="https://andmktg.com/the-audit/">');
  expect(html).toContain("<h2>One</h2>");
});

it("rejects scripts, event handlers, unsafe links, and too-short drafts", () => {
  for (const html of [
    valid.replace("<p>Three</p>", "<script>alert(1)</script><p>Three</p>"),
    valid.replace(
      'href="https://andmktg.com/the-audit/"',
      'href="javascript:alert(1)"',
    ),
    "<h2>One</h2><p>Too short</p><p>Three</p>",
  ])
    expect(() => sanitizeManualArticleHtml(html)).toThrow();
  expect(
    sanitizeManualArticleHtml(valid.replace("<h2>One", '<h2 onclick="x">One')),
  ).not.toContain("onclick");
});
