import { describe, it, expect } from "vitest";
import { buildWorkPlan, usableAudit } from "./WorkPlanRules";
import {
  inventoryUrl,
  topicOverlap,
  needsInventoryRead,
} from "./InventoryRules";
type Input = Parameters<typeof buildWorkPlan>[0];
function page(
  url = "https://example.com/services/crm/",
): Input["inventory"]["pages"][number] {
  return {
    id: url,
    projectId: "p1",
    url,
    title: "CRM implementation",
    heading: "CRM implementation services",
    description: "",
    content:
      "Client-specific examples and detailed CRM implementation guidance.",
    contentHash: "hash",
    canonical: null,
    robots: null,
    purpose: "Service / product",
    readState: "read",
    readFailure: null,
    readStatus: 200,
    checkedAt: "2026-09-27T00:00:00Z",
    contentAt: "2026-09-27T00:00:00Z",
    changedAt: "2026-09-27T00:00:00Z",
    discoveredAt: "2026-09-27T00:00:00Z",
    linksLimited: 0,
  };
}
function input(): Input {
  return {
    now: Date.parse("2026-09-27T12:00:00Z"),
    goal: "More qualified CRM consultations",
    targets: "CRM implementation — high priority",
    search: {
      available: true,
      startDate: "2026-08-01",
      endDate: "2026-09-01",
      rows: [],
    },
    inventory: {
      pages: [page()],
      links: [],
      audit: undefined,
      evidence: { pages: [], issues: [] },
      limited: false,
    },
  };
}
describe("evidence-backed action selection", () => {
  it("prefers existing coverage to a competing article", () => {
    const plan = buildWorkPlan(input());
    expect(plan.some((p) => p.kind === "improve_page")).toBe(true);
    expect(plan.some((p) => p.kind === "new_content")).toBe(false);
    expect(plan.find((p) => p.kind === "improve_page")?.targetUrl).toBe(
      "https://example.com/services/crm/",
    );
  });
  it("does not treat stale content as verified coverage", () => {
    const i = input();
    i.inventory.pages[0].checkedAt = "2020-01-01";
    expect(buildWorkPlan(i).some((p) => p.id === "inventory")).toBe(true);
    expect(buildWorkPlan(i).some((p) => p.kind === "new_content")).toBe(false);
  });
  it("keeps incomplete inventory gaps as investigations", () => {
    const i = input();
    i.targets = "Web design";
    i.inventory.limited = true;
    expect(buildWorkPlan(i).find((p) => p.id.startsWith("gap:"))?.kind).toBe(
      "investigate",
    );
  });
  it("calls an unmatched topic a provisional gap, never proven demand", () => {
    const i = input();
    i.targets = "Web design";
    const gap = buildWorkPlan(i).find((p) => p.kind === "new_content");
    expect(gap?.evidence).toContain("not proof");
    expect(gap?.confidence).toBe("low");
  });
  it("distinguishes failed analytics from a successful empty report", () => {
    const i = input();
    expect(buildWorkPlan(i).some((p) => p.id === "analytics")).toBe(false);
    i.search.available = false;
    expect(
      buildWorkPlan(i).find((p) => p.id === "analytics")?.evidence,
    ).toContain("not zero");
  });
  it("does not call an unseen historical URL a current defect", () => {
    const i = input();
    i.search.rows = [
      {
        query: "crm",
        page: "https://example.com/retired/",
        impressions: 1000,
        clicks: 10,
        position: 12,
      },
    ];
    expect(buildWorkPlan(i).some((p) => p.targetUrl?.includes("retired"))).toBe(
      false,
    );
  });
  it("uses observed links rather than always suggesting a link", () => {
    const i = input();
    const second = page("https://example.com/blog/crm/");
    i.inventory.pages.push(second);
    i.inventory.links = [
      {
        id: "l1",
        projectId: "p1",
        pageId: i.inventory.pages[0].id,
        targetUrl: second.url,
        anchor: "CRM guide",
      },
    ];
    expect(
      buildWorkPlan(i).some(
        (p) => p.kind === "internal_links" && p.targetUrl === second.url,
      ),
    ).toBe(false);
  });
});
describe("inventory scope and freshness", () => {
  it("rejects cross-host lookalikes, credentials and transactional links", () => {
    for (const url of [
      "https://example.com.evil.test/a",
      "https://user:pass@example.com/a",
      "https://example.com/wp-admin/",
      "https://example.com/?add-to-cart=1",
    ])
      expect(inventoryUrl(url, "example.com")).toBeNull();
  });
  it("removes tracking while preserving distinct query semantics", () => {
    expect(inventoryUrl("/a/?utm_source=x&category=y#top", "example.com")).toBe(
      "https://example.com/a/?category=y",
    );
  });
  it("gives failed reads a bounded retry delay", () => {
    expect(
      needsInventoryRead({
        checkedAt: new Date().toISOString(),
        readState: "unavailable",
      }),
    ).toBe(false);
    expect(needsInventoryRead({ checkedAt: null, readState: "pending" })).toBe(
      true,
    );
  });
  it("matches heading and title terms without equating unrelated topics", () => {
    expect(topicOverlap("CRM implementation", page())).toBe(1);
    expect(topicOverlap("Web design", page())).toBe(0);
  });
});

it("does not promote single-page, partial or stale audits to confirmed defects", () => {
  const audit = {
    status: "completed",
    pagesCrawled: 1,
    pagesTotal: 1,
    completedAt: "2026-09-27T00:00:00Z",
    startedAt: "2026-09-27T00:00:00Z",
  };
  const now = Date.parse("2026-09-27T12:00:00Z");
  expect(usableAudit(audit, now)).toBe(false);
  expect(usableAudit({ ...audit, pagesCrawled: 2, pagesTotal: 20 }, now)).toBe(
    false,
  );
  expect(usableAudit({ ...audit, pagesCrawled: 20, pagesTotal: 20 }, now)).toBe(
    true,
  );
  expect(
    usableAudit(
      { ...audit, pagesCrawled: 20, pagesTotal: 20 },
      now + 8 * 86400000,
    ),
  ).toBe(false);
});
