import { expect, it } from "vitest";
import { defaultImageBrief } from "./ImageVisualBrief";

it("directs software-cost topics to an analog scene rather than invented software UI", () => {
  const brief = defaultImageBrief(
    "Why Your Software Expenses Keep Growing",
    "software consolidation",
  );
  expect(brief).toContain("physical still life");
  expect(brief).toContain("No computers, screens");
  expect(brief).not.toContain("CRM dashboard");
});

it("leaves unrelated topics open to concrete imagery without adding a software metaphor", () => {
  const brief = defaultImageBrief(
    "When to replace your roof",
    "roofing inspection",
  );
  expect(brief).toContain("concrete physical subject");
  expect(brief).not.toContain("tangled cables");
});
