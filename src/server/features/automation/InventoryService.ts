import { sort } from "remeda";
import { InventoryRepository as repo } from "./InventoryRepository";
import {
  inventoryUrl,
  INVENTORY_LIMIT,
  needsInventoryRead,
  pagePurpose,
  evidenceHash,
} from "./InventoryRules";
import { ProjectRepository } from "@/server/features/projects/repositories/ProjectRepository";
import { AuditRepository } from "@/server/features/audit/repositories/AuditRepository";
import { ProjectContextService } from "@/server/features/project-context/services/ProjectContextService";
import { discoverSiteUrls, readInventoryPage } from "@/server/lib/scrape";
import { AppError } from "@/server/lib/errors";
export async function inventorySnapshot(projectId: string) {
  const [pages, links, audit] = await Promise.all([
    repo.list(projectId),
    repo.links(projectId),
    AuditRepository.getLatestAuditForProject(projectId),
  ]);
  const evidence = audit
    ? await repo.auditEvidence(projectId, audit.id)
    : { pages: [], issues: [] };
  return {
    pages,
    links,
    audit,
    evidence,
    limited:
      pages.length >= INVENTORY_LIMIT ||
      links.length > 50000 ||
      evidence.issues.length > 500,
  };
}
export async function seedInventory(projectId: string) {
  const project = await ProjectRepository.getProjectById(projectId);
  if (!project?.domain) throw new AppError("NOT_FOUND");
  const [current, context, discovered, audit] = await Promise.all([
    repo.list(projectId),
    ProjectContextService.getProjectContext(projectId),
    discoverSiteUrls(project.domain, INVENTORY_LIMIT),
    AuditRepository.getLatestAuditForProject(projectId),
  ]);
  const auditData = audit
    ? await repo.auditEvidence(projectId, audit.id)
    : { pages: [] };
  const candidates = [
    ...context.keyPages.map((p) => p.url),
    ...auditData.pages.map((p) => p.url),
    ...discovered.urls,
  ];
  const known = new Set(current.map((p) => p.url));
  for (const raw of candidates) {
    const url = inventoryUrl(raw, project.domain);
    if (!url || known.has(url) || known.size >= INVENTORY_LIMIT) continue;
    known.add(url);
    await repo.seed({
      id: await evidenceHash(`${projectId}\n${url}`),
      projectId,
      url,
      discoveredAt: new Date().toISOString(),
    });
  }
  return {
    total: known.size,
    limited: known.size >= INVENTORY_LIMIT,
    discoveryUnavailable: discovered.blocked,
  };
}
export async function refreshInventoryBatch(projectId: string) {
  const project = await ProjectRepository.getProjectById(projectId);
  if (!project?.domain) throw new AppError("NOT_FOUND");
  const all = await repo.list(projectId),
    now = Date.now();
  const queue = sort(
    all.filter((p) => needsInventoryRead(p, now)),
    (a, b) => (a.checkedAt ?? "").localeCompare(b.checkedAt ?? ""),
  );
  // Bounded, sequential reads reuse the native SSRF guard, HTML analyzer and response size cap.
  for (const page of queue.slice(0, 5)) {
    const checkedAt = new Date().toISOString();
    if (!inventoryUrl(page.url, project.domain)) continue;
    let diagnostic: { reason: string; status: number | null } | undefined;
    const result = await readInventoryPage(page.url, (failure) => {
      diagnostic = failure;
    });
    if (!result) {
      await repo.unavailable(projectId, page.id, checkedAt, diagnostic);
      continue;
    }
    const contentHash = await evidenceHash(result.bodyText);
    const validLinks = new Map<string, string>();
    for (const link of result.links) {
      const url = inventoryUrl(link.targetUrl, project.domain);
      if (url && url !== page.url) validLinks.set(url, link.anchor ?? "");
    }
    await repo.save(
      projectId,
      page.id,
      {
        title: result.title.slice(0, 500),
        heading: (result.h1s[0] ?? "").slice(0, 500),
        description: result.metaDescription.slice(0, 1000),
        content: result.bodyText.slice(0, 12000),
        contentHash,
        canonical: result.canonical,
        robots: result.robotsMeta,
        purpose: pagePurpose(page.url, result.title, result.h1s[0] ?? ""),
        readState: "read",
        readFailure: null,
        readStatus: result.statusCode,
        checkedAt,
        contentAt: checkedAt,
        changedAt:
          contentHash === page.contentHash ? page.changedAt : checkedAt,
        linksLimited: validLinks.size > 100 ? 1 : 0,
      },
      [...validLinks]
        .slice(0, 100)
        .map(([targetUrl, anchor]) => ({ targetUrl, anchor })),
    );
    // Native audits/sitemaps seed first; discovered internal links expand coverage within the same project cap.
    for (const targetUrl of validLinks.keys()) {
      if (all.length >= INVENTORY_LIMIT) break;
      if (all.some((p) => p.url === targetUrl)) continue;
      const seed = {
        id: await evidenceHash(`${projectId}\n${targetUrl}`),
        projectId,
        url: targetUrl,
        discoveredAt: checkedAt,
      };
      await repo.seed(seed);
      // Only membership/size is needed for the rest of this batch.
      all.push({ ...page, ...seed, readState: "pending", checkedAt: null });
    }
  }
  const remaining = (await repo.list(projectId)).filter((p) =>
    needsInventoryRead(p),
  ).length;
  return {
    processed: Math.min(queue.length, 5),
    remaining,
    limited: all.length >= INVENTORY_LIMIT,
  };
}
