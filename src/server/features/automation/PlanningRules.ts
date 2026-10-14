export type PlanInput = {
  goal: string;
  targets: string;
  audit: {
    state: "missing" | "blocked" | "incomplete" | "available" | "unavailable";
    observedAt?: string;
    pages: number;
  };
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
};
export function buildPlanRecommendations(input: PlanInput) {
  const items: {
    id: string;
    category: string;
    title: string;
    evidence: string;
    action: string;
    verification: string;
  }[] = [];
  if (input.audit.state !== "available")
    items.push({
      id: "crawl",
      category: "Technical investigation",
      title: "Establish trustworthy crawl coverage",
      evidence: `Audit evidence is ${input.audit.state}.`,
      action:
        "Check crawl access and coverage. Blocked fetches cannot establish missing headings or metadata, and do not establish that Googlebot is blocked.",
      verification:
        "A usable crawl with dated coverage and exclusions recorded.",
    });
  if (!input.goal.trim() || !input.targets.trim())
    items.push({
      id: "focus",
      category: "Strategy",
      title: "Clarify the business focus",
      evidence: "The current goal or target topics are missing from Context.",
      action:
        "Use existing client information to identify the priority service, audience and business outcome. Ask only for decisions missing from the available context.",
      verification:
        "A clear business goal and relevant target topics saved in native Context.",
    });
  if (!input.search.available)
    items.push({
      id: "search",
      category: "Analytics",
      title: "Restore search evidence",
      evidence:
        "Search performance could not be read. Unavailable does not mean zero traffic.",
      action: "Check the Search Console connection and property access.",
      verification: "A report loads with explicit start and end dates.",
    });
  else
    items.push({
      id: "mapping",
      category: "Page investigation",
      title: input.search.rows.length
        ? "Match historical search destinations to the current site"
        : "Research demand beyond current impressions",
      evidence: `${input.search.rows.length} query/page rows returned. Current page availability has not been checked.`,
      action:
        "Review business relevance and search intent. Verify existing destinations and changed URLs before choosing a repair, page improvement or new article. Near-page-one position alone is not a business opportunity.",
      verification:
        "An intent-to-page map with current-page checks and explicit decisions for retired URLs.",
    });
  items.push({
    id: "brief",
    category: "Content research",
    title: "Prepare a brief with an original contribution",
    evidence: input.targets.trim()
      ? "Business targets express priorities, not proven demand."
      : "No article topic has been selected.",
    action:
      "Select a validated gap. Gather client experience, a worked example or analysis, and sources for material claims. Research missing evidence or request focused expert input before drafting.",
    verification:
      "Brief states the reader question, original contribution, evidence, voice guidance and business purpose.",
  });
  return items;
}
export const CONTENT_QUALITY_CHECKS = [
  "Answer a specific reader question with useful insight or a decision framework.",
  "Contribute client experience, a worked example, a case study, a comparison or clearly labelled analysis.",
  "Trace statistics to a source, date, population and context. Omit unsupported numbers; statistics are not mandatory.",
  "Use first-person experience and client results only when supplied or verified. Never invent a human experience.",
  "Follow client voice guidance. Remove stock introductions, repetitive transitions, filler and unsupported superlatives.",
  "Review factual accuracy, source support, existing-page overlap, internal links and the reader's next step.",
];
