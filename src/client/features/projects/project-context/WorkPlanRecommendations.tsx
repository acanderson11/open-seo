import type { getMonthlyWorkPlan } from "@/serverFunctions/workPlanning";
type Plan = Awaited<ReturnType<typeof getMonthlyWorkPlan>>;
export function WorkRecommendations({
  plan,
  busy,
  onAccept,
}: {
  plan: Plan;
  busy: boolean;
  onAccept: (item: Plan["recommendations"][number]) => void;
}) {
  return (
    <section aria-labelledby="recommended-work-heading">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 id="recommended-work-heading" className="text-lg font-semibold">
            Choose this month's work
          </h2>
          <p className="mt-1 text-sm text-base-content/70">
            Review each suggestion and add the useful ones to the execution
            board.
          </p>
        </div>
        <span className="text-sm text-base-content/60">
          {plan.recommendations.length} suggestions
        </span>
      </div>
      <div className="mt-3 divide-y divide-base-300 border-y border-base-300">
        {plan.recommendations.map((item) => (
          <article key={item.id} className="py-4">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-base-content/60">
              <span className="font-semibold uppercase tracking-wide text-base-content/80">
                {item.priority} priority
              </span>
              <span>{item.effort} effort</span>
              <span>{item.confidence} evidence confidence</span>
            </div>
            <h3 className="mt-2 font-semibold">{item.title}</h3>
            {item.targetUrl && (
              <a
                className="link mt-1 block break-all text-sm"
                href={item.targetUrl}
                target="_blank"
                rel="noreferrer"
              >
                {item.targetUrl}
              </a>
            )}
            <p className="mt-2 text-sm">
              <strong>Why it matters:</strong> {item.businessValue}
            </p>
            <p className="mt-1 text-sm">
              <strong>Suggested next step:</strong> {item.action}
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <button
                className="btn btn-outline btn-sm"
                disabled={!!item.taskId || busy}
                onClick={() => onAccept(item)}
              >
                {item.taskId ? "Added to board" : "Add task to board"}
              </button>
              <details className="text-sm text-base-content/70">
                <summary className="cursor-pointer">
                  Evidence and completion check
                </summary>
                <div className="mt-2 max-w-3xl space-y-2">
                  <p>{item.evidence}</p>
                  <p>
                    <strong>Done when:</strong> {item.objective}
                  </p>
                </div>
              </details>
            </div>
          </article>
        ))}
      </div>
      {!plan.recommendations.length && (
        <p className="mt-3 text-sm text-base-content/70">
          No suggestions yet. Check the business focus and evidence coverage
          below, then scan the website if page information is missing.
        </p>
      )}
    </section>
  );
}
