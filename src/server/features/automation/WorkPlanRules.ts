import { sort } from "remeda";
import type {
  TaskCategory,
  TaskPriority,
} from "@/types/schemas/executionBoard";
import { priorityRank } from "@/types/schemas/executionBoard";
import { topicOverlap, needsInventoryRead } from "./InventoryRules";
import type { inventorySnapshot } from "./InventoryService";
type Inventory = Awaited<ReturnType<typeof inventorySnapshot>>;
export type WorkRecommendation = {
  id: string;
  kind:
    | "improve_page"
    | "new_content"
    | "internal_links"
    | "technical"
    | "local"
    | "authority"
    | "investigate";
  category: TaskCategory;
  priority: TaskPriority;
  confidence: "medium" | "low";
  effort: "Small" | "Medium" | "Large";
  title: string;
  targetUrl: string | null;
  topic: string | null;
  evidence: string;
  action: string;
  objective: string;
  businessValue: string;
};
export function usableAudit(
  audit:
    | {
        status: string;
        pagesCrawled: number;
        pagesTotal: number;
        completedAt: string | null;
        startedAt: string;
      }
    | undefined,
  now: number,
) {
  return (
    !!audit &&
    audit.status === "completed" &&
    audit.pagesCrawled > 1 &&
    audit.pagesCrawled >= audit.pagesTotal &&
    now - Date.parse(audit.completedAt ?? audit.startedAt) < 7 * 86400000
  );
}
export function buildWorkPlan(input: {
  inventory: Inventory;
  targets: string;
  goal: string;
  search: {
    available: boolean;
    startDate?: string;
    endDate?: string;
    rows: {
      query: string;
      page: string;
      impressions: number;
      clicks: number;
      position: number;
    }[];
  };
  now?: number;
}) {
  const { inventory, search } = input,
    now = input.now ?? Date.now();
  const current = inventory.pages.filter(
    (p) => p.readState === "read" && !needsInventoryRead(p, now),
  );
  const suggestions: WorkRecommendation[] = [];
  const add = (item: WorkRecommendation) => {
    if (!suggestions.some((s) => s.id === item.id)) suggestions.push(item);
  };
  const targets = input.targets
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 20);
  const window =
    search.startDate && search.endDate
      ? `${search.startDate}–${search.endDate}`
      : "the returned report";
  if (!current.length)
    add({
      id: "inventory",
      kind: "investigate",
      category: "technical",
      priority: "high",
      confidence: "low",
      effort: "Small",
      title: "Read current pages before choosing content work",
      targetUrl: null,
      topic: null,
      evidence: `${inventory.pages.length} discovered pages; none have a successful read in the last seven days.`,
      action:
        "Scan the website here. Use Site Audit for blocked pages, redirects, and broader technical diagnosis. A failed fetch does not establish a Google indexing problem.",
      objective:
        "Readable, dated coverage of the important service and content pages.",
      businessValue:
        "Avoid work based on stale or incomplete page information.",
    });
  if (!search.available)
    add({
      id: "analytics",
      kind: "investigate",
      category: "analytics",
      priority: "high",
      confidence: "low",
      effort: "Small",
      title: "Restore search performance evidence",
      targetUrl: null,
      topic: null,
      evidence: "Search data is unavailable, not zero.",
      action:
        "Check the connected Search Console property and access. Business targets can still guide research while data is unavailable.",
      objective: "A dated report from the correct property.",
      businessValue: "Distinguish actual demand from assumptions.",
    });
  for (const target of targets) {
    const topic = target.split(/\s+[—–]|\s+-\s+|;/)[0].trim();
    if (!topic) continue;
    const candidates = sort(
      current
        .map((page) => ({ page, score: topicOverlap(topic, page) }))
        .filter((x) => x.score >= 0.6),
      (a, b) => b.score - a.score,
    ).slice(0, 3);
    if (candidates.length) {
      const page = candidates[0].page;
      const rows = search.rows.filter((r) => r.page === page.url);
      add({
        id: `improve:${page.url}`,
        kind: "improve_page",
        category: "content",
        priority: "high",
        confidence: "medium",
        effort: "Medium",
        title: `Improve existing coverage: ${topic}`.slice(0, 180),
        targetUrl: page.url,
        topic,
        evidence: `Business target: ${target}. Title/heading/URL overlap points to ${page.title || page.url}, read ${page.contentAt}. ${rows.length} returned query rows for this exact URL in ${window}. ${candidates.length > 1 ? "Other pages also overlap; resolve intent before creating or consolidating content." : ""}`,
        action:
          "Review the existing page against the reader’s intent and business goal. Propose specific missing explanations, client examples and conversion steps. Confirm the lexical match before treating it as the same intent. Prefer improving this page over commissioning a competing article.",
        objective:
          "An approved, evidence-backed improvement brief for the existing URL, with a baseline and next review date.",
        businessValue: input.goal || `Support the business priority: ${topic}.`,
      });
    } else
      add({
        id: `gap:${topic.toLowerCase()}`,
        kind:
          current.length &&
          !inventory.limited &&
          inventory.pages.every(
            (p) => p.readState === "read" && !needsInventoryRead(p, now),
          )
            ? "new_content"
            : "investigate",
        category: "content",
        priority: "normal",
        confidence: "low",
        effort: "Medium",
        title: `Investigate a content gap: ${topic}`.slice(0, 180),
        targetUrl: null,
        topic,
        evidence: `Business target: ${target}. No strong title/heading/URL match in ${current.length} recently read pages. This is not proof of an uncovered intent or search demand.`,
        action:
          "Validate the search intent, current results, and existing-page coverage. Choose an article, service-page improvement, or no new page. Gather a useful client example and source-backed evidence before drafting.",
        objective:
          "A distinct reader need and justified page type; reject or merge overlapping proposals.",
        businessValue:
          input.goal || `Evaluate the business priority: ${topic}.`,
      });
  }
  // Search rows support investigation, never an inferred live defect or a promise of lift.
  for (const row of sort(
    [...search.rows].filter(
      (r) => r.impressions >= 30 && r.position >= 5 && r.position <= 25,
    ),
    (a, b) => b.impressions - a.impressions,
  ).slice(0, 12)) {
    const page = current.find((p) => p.url === row.page);
    if (!page) continue;
    const relevant = targets.some(
      (t) => topicOverlap(t.split(/[;—–]/)[0], page) >= 0.6,
    );
    add({
      id: `improve:${page.url}`,
      kind: "improve_page",
      category: "content",
      priority: relevant ? "high" : "normal",
      confidence: "medium",
      effort: "Medium",
      title: `Review search opportunity: ${row.query}`.slice(0, 180),
      targetUrl: page.url,
      topic: row.query,
      evidence: `${row.impressions} impressions, ${row.clicks} clicks, average position ${row.position.toFixed(1)} for “${row.query}” in ${window}. Page read ${page.contentAt}.`,
      action:
        "Confirm commercial relevance and search intent. Compare the current page with what the reader needs; investigate snippet, content and internal-link improvements. Average position alone does not establish potential revenue or a CTR problem.",
      objective:
        "A specific proposed improvement with baseline query/page metrics and a review date.",
      businessValue: relevant
        ? "Matches a saved business target."
        : "Business relevance needs agency confirmation.",
    });
  }
  const auditFresh = usableAudit(inventory.audit, now);
  if (!auditFresh)
    add({
      id: "audit-coverage",
      kind: "investigate",
      category: "technical",
      priority: "high",
      confidence: "low",
      effort: "Small",
      title: "Investigate native audit coverage",
      targetUrl: null,
      topic: null,
      evidence: `Latest audit has ${inventory.audit?.pagesCrawled ?? 0} crawled pages and is missing, incomplete, or older than seven days.`,
      action:
        "Check crawl access, redirects, empty responses and audit scope. Do not infer missing metadata from an unreadable response. Other supported work can continue.",
      objective:
        "A dated, representative audit with failed reads distinguished from actual defects.",
      businessValue:
        "Avoid spending time fixing false-positive technical findings.",
    });
  if (auditFresh)
    for (const issue of inventory.evidence.issues.slice(0, 500)) {
      const page = inventory.evidence.pages.find(
        (p) => p.url === issue.pageUrl,
      );
      const live = current.find((p) => p.url === issue.pageUrl);
      if (!supportedAuditIssue(page, live, issue)) continue;
      add({
        id: `technical:${issue.issueType}:${issue.pageUrl}`,
        kind: "technical",
        category: "technical",
        priority: issue.severity === "critical" ? "critical" : "normal",
        confidence: "medium",
        effort: "Medium",
        title:
          `Verify and resolve ${issue.issueType.replaceAll("_", " ")}`.slice(
            0,
            180,
          ),
        targetUrl: issue.pageUrl,
        topic: null,
        evidence: `Native audit ${inventory.audit!.id}, ${inventory.audit!.completedAt ?? inventory.audit!.startedAt}: ${issue.issueType} (${issue.severity}).`,
        action:
          "Reproduce the dated audit finding and confirm the intended page behavior. Propose a scoped fix, preserve a rollback path, and verify the result. Intentional exclusions or redirects may need no change.",
        objective:
          "The confirmed issue is resolved, or its intended behavior is documented.",
        businessValue:
          "Remove a verified obstacle to discovery, access or usability.",
      });
    }
  const freshIds = new Set(current.map((p) => p.id));
  const observedLinks = inventory.links.filter((l) => freshIds.has(l.pageId));
  for (const page of current.filter((p) => new URL(p.url).pathname !== "/")) {
    if (observedLinks.some((l) => l.targetUrl === page.url)) continue;
    const source = sort(
      current
        .filter((p) => p.id !== page.id)
        .map((p) => ({
          page: p,
          score: topicOverlap(page.heading || page.title, p),
        })),
      (a, b) => b.score - a.score,
    )[0];
    if (!source || source.score < 0.35) continue;
    add({
      id: `links:${page.url}`,
      kind: "internal_links",
      category: "content",
      priority: "normal",
      confidence: "low",
      effort: "Small",
      title: `Review incoming links for ${page.title || page.url}`.slice(
        0,
        180,
      ),
      targetUrl: page.url,
      topic: null,
      evidence: `No incoming link observed in ${current.length} recently read pages. Candidate source: ${source.page.url}. Coverage is bounded; this does not prove the page is orphaned.`,
      action: `Review ${source.page.url} for a useful contextual link to this page, and the reverse direction if helpful. Propose the exact anchor and placement. Do not add links solely to satisfy a quota.`,
      objective:
        "Relevant links are implemented and verified, or the recommendation is dismissed with a reason.",
      businessValue: "Help readers and crawlers reach useful related pages.",
    });
  }
  if (!targets.length)
    add({
      id: "business-focus",
      kind: "investigate",
      category: "general",
      priority: "high",
      confidence: "low",
      effort: "Small",
      title: "Confirm priority services and target topics",
      targetUrl: null,
      topic: null,
      evidence: "No target topics saved in native Context.",
      action:
        "Use the existing client questionnaire and website to propose business priorities; save the agreed topics in Context.",
      objective:
        "A business goal and relevant target topics are available to planning.",
      businessValue: "Prevent a traffic-only content strategy.",
    });
  return sort(
    suggestions,
    (a, b) =>
      priorityRank[a.priority] - priorityRank[b.priority] ||
      a.id.localeCompare(b.id),
  ).slice(0, 40);
}

function supportedAuditIssue(
  page: Inventory["evidence"]["pages"][number] | undefined,
  live: Inventory["pages"][number] | undefined,
  issue: Inventory["evidence"]["issues"][number],
) {
  if (
    !page ||
    page.fetchClass !== "ok" ||
    issue.severity === "info" ||
    !live ||
    !page.statusCode ||
    page.statusCode < 200 ||
    page.statusCode >= 300
  )
    return false;
  if (
    (issue.issueType === "missing-title" && live.title) ||
    (issue.issueType === "missing-h1" && live.heading) ||
    (issue.issueType === "missing-meta-description" && live.description)
  )
    return false;
  return true;
}
