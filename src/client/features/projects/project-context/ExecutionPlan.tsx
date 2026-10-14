import { ScanAccessHelp } from "./ScanAccessHelp";
import { SeoBriefs } from "./SeoBriefs";
import { inventoryReadMessage } from "@/shared/inventory-read";
import { WorkRecommendations } from "./WorkPlanRecommendations";
import { useState, useRef, useEffect } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  getMonthlyWorkPlan,
  discoverInventory,
  refreshInventory,
  acceptPlanItem,
} from "@/serverFunctions/workPlanning";
import { getStandardErrorMessage } from "@/client/lib/error-messages";
export function ExecutionPlan({ projectId }: { projectId: string }) {
  const client = useQueryClient(),
    stop = useRef(false);
  const [scanning, setScanning] = useState(false),
    [progress, setProgress] = useState(""),
    [filter, setFilter] = useState(""),
    [visible, setVisible] = useState(25);
  useEffect(
    () => () => {
      stop.current = true;
    },
    [],
  );
  const query = useQuery({
    queryKey: ["work-plan", projectId],
    queryFn: () => getMonthlyWorkPlan({ data: { projectId } }),
    staleTime: 300000,
    refetchOnWindowFocus: false,
    retry: false,
  });
  const accept = useMutation({
    mutationFn: (item: { id: string; fingerprint: string; month: string }) =>
      acceptPlanItem({ data: { projectId, ...item } }),
    onSuccess: async () => {
      toast.success("Added to the execution board");
      await client.invalidateQueries({ queryKey: ["automation", projectId] });
      await query.refetch();
    },
    onError: (error) =>
      toast.error(
        getStandardErrorMessage(
          error,
          "The evidence may have changed. Refresh the plan and try again.",
        ),
      ),
  });
  async function scan() {
    stop.current = false;
    setScanning(true);
    setProgress("Discovering pages from the site and native audit…");
    try {
      const seed = await discoverInventory({ data: { projectId } });
      setProgress(`${seed.total} known pages. Reading new or stale pages…`);
      let processed = 0;
      for (let batch = 0; batch < 100 && !stop.current; batch++) {
        const result = await refreshInventory({ data: { projectId } });
        processed += result.processed;
        setProgress(
          `${processed} pages checked · ${result.remaining} waiting${result.limited ? " · 500-page discovery limit reached" : ""}`,
        );
        if (!result.remaining || !result.processed) break;
      }
      await query.refetch();
    } catch (error) {
      setProgress(
        getStandardErrorMessage(
          error,
          "Scan interrupted. Completed pages are saved; you can resume.",
        ),
      );
    } finally {
      setScanning(false);
    }
  }
  if (query.isPending)
    return (
      <p role="status" className="p-6">
        Reading site inventory and search evidence…
      </p>
    );
  if (query.isError)
    return (
      <div role="alert" className="p-6">
        <p>
          {getStandardErrorMessage(
            query.error,
            "Could not load the work plan.",
          )}
        </p>
        <button
          className="btn btn-outline btn-sm mt-3"
          onClick={() => void query.refetch()}
        >
          Try again
        </button>
      </div>
    );
  const plan = query.data,
    pages = plan.inventory.pages.filter((p) =>
      `${p.url} ${p.title} ${p.purpose}`
        .toLowerCase()
        .includes(filter.toLowerCase()),
    ),
    readPages = plan.inventory.pages.filter(
      (p) => p.readState === "read",
    ).length,
    unavailablePages = plan.inventory.pages.filter(
      (p) => p.readState === "unavailable",
    ).length;
  return (
    <main className="mx-auto max-w-6xl space-y-8 p-4 md:p-6">
      <header className="flex flex-wrap justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">SEO work plan</h1>
          <p className="mt-2 max-w-2xl text-sm text-base-content/70">
            {plan.month} · Choose which suggestions become tasks this month. The
            suggestions weigh your goals against available site, search, and
            audit evidence. Check the reason before adding a task; it will not
            change the website.
          </p>
        </div>
        <button
          className="btn btn-outline btn-sm"
          disabled={query.isFetching || scanning}
          onClick={() => void query.refetch()}
        >
          {query.isFetching ? "Refreshing…" : "Refresh plan"}
        </button>
      </header>
      <section
        className="rounded-lg border border-base-300 p-4"
        aria-labelledby="work-plan-focus"
      >
        <h2 id="work-plan-focus" className="font-semibold">
          Business focus
        </h2>
        <p className="mt-1 whitespace-pre-wrap text-sm">
          {plan.goal ||
            "No business goal saved. Add one to make the suggestions more relevant."}
        </p>
        {plan.targets && (
          <p className="mt-1 whitespace-pre-wrap text-sm text-base-content/70">
            Target topics: {plan.targets}
          </p>
        )}
        <Link
          className="link mt-2 inline-block text-sm"
          to="/p/$projectId/settings/context"
          params={{ projectId }}
        >
          Edit goals and topics
        </Link>
      </section>
      <WorkRecommendations
        plan={plan}
        busy={accept.isPending || scanning || query.isFetching}
        onAccept={(item) =>
          accept.mutate({
            id: item.id,
            fingerprint: item.fingerprint,
            month: plan.month,
          })
        }
      />
      <section>
        <div className="flex flex-wrap justify-between items-center gap-3">
          <div>
            <h2 className="text-lg font-semibold">Website inventory</h2>
            <p className="text-sm mt-1">
              {plan.inventory.pages.length} known pages · {readPages} read
              {unavailablePages > 0 && ` · ${unavailablePages} unavailable`}
            </p>
          </div>
          <div className="flex gap-2">
            <button
              className="btn btn-primary btn-sm"
              disabled={scanning}
              onClick={() => void scan()}
            >
              {scanning ? "Scanning…" : "Scan website"}
            </button>
            {scanning && (
              <button
                className="btn btn-outline btn-sm"
                onClick={() => {
                  stop.current = true;
                  setProgress(
                    "Stopping after the current batch. Completed pages are saved.",
                  );
                }}
              >
                Stop scan
              </button>
            )}
          </div>
        </div>
        <p className="mt-2 max-w-2xl text-sm text-base-content/70">
          Scan to find existing pages before choosing content work. The plan
          uses those pages to suggest updates and avoid duplicate topics.
        </p>
        {progress && (
          <p className="text-sm mt-2" role="status">
            {progress}
          </p>
        )}
        {unavailablePages > 0 && (
          <p className="mt-2 text-sm text-warning">
            Some pages could not be read. Open the inventory for the reason
            before treating a missing topic as a content gap.
          </p>
        )}
        <ScanAccessHelp pages={plan.inventory.pages} />
        {plan.inventory.limited && (
          <p className="text-warning text-sm mt-2">
            Coverage limit reached. Use Site Audit to investigate pages outside
            this inventory; an unmatched topic is not a verified gap.
          </p>
        )}
        <details className="mt-4 border-t border-base-300 pt-3">
          <summary className="cursor-pointer text-sm font-medium">
            Browse page inventory and read details
          </summary>
          <label className="block mt-4 text-sm">
            Find a page
            <input
              className="input input-bordered w-full mt-1"
              value={filter}
              onChange={(e) => {
                setFilter(e.target.value);
                setVisible(25);
              }}
              placeholder="Search titles, URLs or page purposes"
            />
          </label>
          <div className="divide-y divide-base-300 mt-3">
            {pages.slice(0, visible).map((page) => (
              <details key={page.id} className="py-3">
                <summary className="cursor-pointer break-words">
                  <span className="font-medium">{page.title || page.url}</span>
                  <span className="block text-xs text-base-content/60 mt-1">
                    {page.purpose} · {page.readState} ·{" "}
                    {page.checkedAt
                      ? new Date(page.checkedAt).toLocaleString()
                      : "Not read yet"}
                  </span>
                </summary>
                <div className="mt-3 text-sm space-y-2">
                  <a
                    className="link break-all"
                    href={page.url}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {page.url}
                  </a>
                  {page.readState === "unavailable" && (
                    <p className="text-warning">
                      {inventoryReadMessage(page.readFailure, page.readStatus)}
                    </p>
                  )}
                  <p>
                    {page.incoming} observed incoming links · {page.outgoing}{" "}
                    outgoing links{page.linksLimited ? " (limited)" : ""}.
                    Counts include older snapshots and are not a complete site
                    graph.
                  </p>
                  <p>
                    Canonical: {page.canonical || "Not recorded"} · Robots meta:{" "}
                    {page.robots || "Not recorded"}
                  </p>
                  <p className="text-base-content/70">
                    {page.excerpt || "No readable content captured."}
                  </p>
                  {page.readState !== "read" && page.contentAt && (
                    <p>
                      Last successful content: {page.contentAt}. The most recent
                      read did not confirm it.
                    </p>
                  )}
                </div>
              </details>
            ))}
          </div>
          {!pages.length && (
            <p className="text-sm mt-3">
              {filter
                ? "No matching pages."
                : "Scan the website to build its page inventory."}
            </p>
          )}
          {pages.length > visible && (
            <button
              className="btn btn-ghost btn-sm mt-2"
              onClick={() => setVisible((n) => n + 25)}
            >
              Show more pages
            </button>
          )}
        </details>
      </section>
      <EvidenceCoverage plan={plan} />
      <details className="border-t border-base-300 pt-5">
        <summary className="cursor-pointer text-lg font-semibold">
          Investigate a topic or create a content brief
        </summary>
        <div className="mt-4">
          <SeoBriefs projectId={projectId} />
        </div>
      </details>
      <ExistingWork plan={plan} />
    </main>
  );
}

type Plan = Awaited<ReturnType<typeof getMonthlyWorkPlan>>;
function ExistingWork({ plan }: { plan: Plan }) {
  return (
    <details className="border-t border-base-300 pt-5">
      <summary className="cursor-pointer text-lg font-semibold">
        Existing work ({plan.activeTasks.length} active tasks)
      </summary>
      <ul className="mt-2 space-y-2 text-sm">
        {plan.activeTasks.map((task) => (
          <li key={task.id}>
            {task.title} · {task.state.replaceAll("_", " ")}
          </li>
        ))}
      </ul>
      {!plan.activeTasks.length && (
        <p className="mt-2 text-sm">No active tasks in the returned records.</p>
      )}
      {plan.tasksLimited && (
        <p className="text-sm mt-2">
          Recent tasks only; review the full board before committing work.
        </p>
      )}
    </details>
  );
}

function EvidenceCoverage({ plan }: { plan: Plan }) {
  return (
    <details className="border-t border-base-300 pt-5">
      <summary className="cursor-pointer text-lg font-semibold">
        Evidence coverage
        <span className="mt-1 block text-sm font-normal text-base-content/60">
          Search {plan.search.available ? "available" : "unavailable"} · audit{" "}
          {plan.audit.state.replaceAll("_", " ")} · conversion evidence{" "}
          {plan.conversions.available ? "available" : "unavailable"}
        </span>
      </summary>
      <p className="mt-2 text-sm text-base-content/70">
        Check these sources when a suggestion seems uncertain. Missing data
        means less confidence; it does not mean zero traffic or conversions.
      </p>
      <p className="text-sm mt-2">
        Search:{" "}
        {plan.search.available
          ? `${plan.search.startDate}–${plan.search.endDate}; ${plan.search.rows.length} returned query/page rows (maximum 200).`
          : "Unavailable; not zero traffic."}
      </p>
      <p className="text-sm mt-2">
        Native audit: {plan.audit.state} · {plan.audit.pages} pages ·{" "}
        {plan.inventory.auditAt || "No dated audit"}.
      </p>
      <p className="text-sm mt-2">
        {plan.conversions.available
          ? `GSC/GA4 opportunity report: ${plan.conversions.request.dateRange.startDate}–${plan.conversions.request.dateRange.endDate}. ${plan.conversions.rows.length} candidate pages. Business-value metric: ${plan.conversions.metric}${plan.conversions.limited ? " (limited data)" : ""}.`
          : "Joined conversion evidence unavailable. Do not infer zero conversions."}
      </p>
      {plan.conversions.available && (
        <details className="mt-2 text-sm">
          <summary className="cursor-pointer">
            View candidate-page conversion evidence
          </summary>
          <ul className="mt-2 space-y-2">
            {plan.conversions.rows.map((row) => (
              <li key={row.page} className="break-all">
                {row.page}: {row.sessions ?? "Unknown"} sessions ·{" "}
                {row.keyEvents ?? "Unknown"} key events
              </li>
            ))}
          </ul>
          <p className="mt-2">
            Key events depend on GA4 configuration and are not automatically
            qualified leads. This candidate report does not represent every
            page.
          </p>
        </details>
      )}
    </details>
  );
}
