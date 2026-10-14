import { BriefRepository } from "./BriefRepository";
import { validateTarget } from "./AutomationService";
import { readPages } from "@/server/lib/scrape";
export async function revisionSources(
  projectId: string,
  requestKey: string,
  targetUrl: string,
  domain: string,
) {
  const brief = await BriefRepository.detail(projectId, requestKey);
  const saved = (brief?.sources ?? [])
    .flatMap((source) => {
      if (source.kind !== "page" || !source.url || !source.content.trim())
        return [];
      const observedAt = Date.parse(source.observedAt);
      if (!Number.isFinite(observedAt) || observedAt > Date.now()) return [];
      try {
        return [
          {
            url: validateTarget(source.url, domain),
            text: source.content.slice(0, 12000),
            observedAt,
          },
        ];
      } catch {
        return [];
      }
    })
    .slice(0, 8);
  const recent = saved.filter(
    (page) => Date.now() - page.observedAt < 7 * 86400000,
  );
  if (recent.length)
    return {
      pages: recent.map(({ url, text }) => ({ url, text })),
      warning: null,
    };

  const fresh = await readPages([validateTarget(targetUrl, domain)], 1);
  if (fresh.pages.length) return { pages: fresh.pages, warning: null };
  if (!saved.length) return { pages: [], warning: null };

  const dates = saved.map((page) =>
    new Date(page.observedAt).toISOString().slice(0, 10),
  );
  const oldest = dates.reduce((a, b) => (a < b ? a : b));
  const newest = dates.reduce((a, b) => (a > b ? a : b));
  const range = oldest === newest ? oldest : `${oldest} to ${newest}`;
  const warning = `Live site pages could not be read. Historical site snapshots captured ${range} were used; verify current business facts and dates before approval.`;
  return {
    pages: saved.map(({ url, text, observedAt }) => ({
      url,
      text: `Historical site page captured ${new Date(observedAt).toISOString()}. It may have changed; do not present time-sensitive details as current without other evidence.\n${text}`,
    })),
    warning,
  };
}
