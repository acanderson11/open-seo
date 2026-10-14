import { ExecutionPlan } from "@/client/features/projects/project-context/ExecutionPlan";
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { ExecutionBoard } from "@/client/features/projects/project-context/ExecutionBoard";
export const Route = createFileRoute("/_project/p/$projectId/execution")({
  validateSearch: z.object({
    executionView: z.enum(["board", "plan"]).optional(),
    topic: z.string().max(500).optional(),
    targetUrl: z.string().max(1000).optional(),
  }),
  component: Page,
});
function Page() {
  const { projectId } = Route.useParams(),
    search = Route.useSearch();
  const navigate = Route.useNavigate();
  return (
    <div className="h-full overflow-auto">
      <nav
        aria-label="Execution views"
        className="flex gap-2 border-b border-base-300 px-4 py-3"
      >
        {(["board", "plan"] as const).map((view) => (
          <button
            key={view}
            className={`btn btn-sm ${(search.executionView ?? "board") === view ? "btn-primary" : "btn-ghost"}`}
            aria-pressed={(search.executionView ?? "board") === view}
            onClick={() =>
              void navigate({ search: { ...search, executionView: view } })
            }
          >
            {view === "board" ? "Board" : "Work plan"}
          </button>
        ))}
      </nav>
      {search.executionView === "plan" ? (
        <ExecutionPlan key={projectId} projectId={projectId} />
      ) : (
        <ExecutionBoard
          key={projectId + JSON.stringify(search)}
          projectId={projectId}
          {...search}
        />
      )}
    </div>
  );
}
