import { expect, it } from "vitest";
import { validateBrief } from "./BriefRules";
const sources = [
  {
    id: "e0",
    kind: "page",
    title: "Service",
    url: "https://example.com/service",
    content: "We design websites for local service businesses.",
    observedAt: "2026-09-27",
  },
];
const proposal = {
  title: "Website redesign",
  action: "create_new",
  targetEvidenceId: null,
  audience: "Service businesses",
  intent: "Evaluate a redesign",
  angle: "Measure business outcomes",
  rationale: "Relevant service",
  successMeasure: "Qualified inquiries",
  confidence: "medium",
  findings: [
    {
      detail: "Business alignment",
      evidenceId: "e0",
      quote: "design websites for local service businesses",
    },
  ],
  outline: [],
  gaps: [],
  expertQuestions: [],
};
it("keeps valid evidence and forces research when inventory is incomplete", () => {
  const result = validateBrief(proposal, sources, true, [
    "Coverage incomplete",
  ]);
  expect(result.action).toBe("research_first");
  expect(result.confidence).toBe("low");
  expect(result.gaps).toContain("Coverage incomplete");
});
it("rejects invented citations and quotes", () => {
  for (const finding of [
    { detail: "Invented", evidenceId: "other", quote: "design websites" },
    { detail: "Invented", evidenceId: "e0", quote: "guaranteed first place" },
  ])
    expect(() =>
      validateBrief({ ...proposal, findings: [finding] }, sources, false, []),
    ).toThrow();
});
it("rejects all-invalid and partially invalid proposals", () => {
  for (const findings of [
    [{ detail: "Unsupported", evidenceId: "e0", quote: "save 90 percent" }],
    [
      proposal.findings[0],
      { detail: "Unsupported", evidenceId: "e0", quote: "save 90 percent" },
    ],
  ])
    expect(() =>
      validateBrief({ ...proposal, findings }, sources, false, []),
    ).toThrow();
});
it("does not accept an unknown source ID even when its quote exists elsewhere", () => {
  expect(() =>
    validateBrief(
      {
        ...proposal,
        findings: [{ ...proposal.findings[0], evidenceId: "unknown" }],
      },
      sources,
      false,
      [],
    ),
  ).toThrow();
});
it("requires a current page for improvements", () => {
  expect(() =>
    validateBrief(
      { ...proposal, action: "improve_existing" },
      sources,
      false,
      [],
    ),
  ).toThrow();
  expect(
    validateBrief(
      { ...proposal, action: "improve_existing", targetEvidenceId: "e0" },
      sources,
      false,
      [],
    ).targetUrl,
  ).toBe(sources[0].url);
  expect(() =>
    validateBrief(
      { ...proposal, targetEvidenceId: "missing" },
      sources,
      false,
      [],
    ),
  ).toThrow();
});
