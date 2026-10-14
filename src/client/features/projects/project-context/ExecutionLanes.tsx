import {
  BOARD_STAGES,
  TASK_CATEGORIES,
  TASK_PRIORITIES,
  stageSchema,
  prioritySchema,
  type TaskPriority,
  type TaskCategory,
  type BoardStage,
} from "@/types/schemas/executionBoard";
export type Card = {
  id: string;
  title: string;
  category: TaskCategory;
  priority: TaskPriority;
  stage: BoardStage;
  kind: "task" | "draft";
  detail: string;
};
const priorityStyles: Record<TaskPriority, string> = {
  critical: "border-error bg-error/10 text-error",
  high: "border-warning bg-warning/10 text-base-content",
  normal: "border-base-300 text-base-content/70",
  low: "border-base-300 text-base-content/50",
};

export function ExecutionLanes({
  visible,
  move,
  moving,
  prioritizing,
  onOpen,
  onPrioritize,
}: {
  visible: Card[];
  move: (id: string, state: BoardStage) => void;
  moving: boolean;
  prioritizing: boolean;
  onOpen: (card: Card) => void;
  onPrioritize: (input: {
    jobId: string;
    priority: TaskPriority;
    expectedPriority: TaskPriority;
  }) => void;
}) {
  return (
    <div
      className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:flex xl:overflow-x-auto xl:pb-4"
      aria-label="Execution kanban board"
    >
      {Object.entries(BOARD_STAGES).map(([stage, label]) => {
        const column = visible.filter((card) => card.stage === stage);
        return (
          <section
            key={stage}
            aria-label={label}
            className="min-w-0 rounded-xl bg-base-200/60 p-3 xl:min-w-64 xl:w-72 xl:shrink-0"
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              event.preventDefault();
              move(
                event.dataTransfer.getData("application/x-openseo-task"),
                stageSchema.parse(stage),
              );
            }}
          >
            <header className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold">{label}</h2>
              <span className="text-xs text-base-content/50">
                {column.length}
              </span>
            </header>
            <div className="space-y-3">
              {column.map((card) => (
                <article
                  key={card.kind + card.id}
                  draggable={card.kind === "task" && !moving}
                  onDragStart={(event) => {
                    if (card.kind === "task")
                      event.dataTransfer.setData(
                        "application/x-openseo-task",
                        card.id,
                      );
                  }}
                  className={`rounded-lg border bg-base-100 p-3 shadow-sm ${card.priority === "critical" ? "border-error/60" : "border-base-300"}`}
                >
                  <button
                    type="button"
                    aria-label={card.title}
                    className="block w-full cursor-pointer rounded text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
                    onClick={() => onOpen(card)}
                  >
                    <span className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-xs text-base-content/60">
                        {TASK_CATEGORIES[card.category]}
                      </span>
                      <span
                        className={`rounded border px-1.5 py-0.5 text-xs font-medium ${priorityStyles[card.priority]}`}
                      >
                        {TASK_PRIORITIES[card.priority]}
                      </span>
                    </span>
                    <span className="mt-2 block text-sm font-semibold leading-snug hover:underline">
                      {card.title}
                    </span>
                    {card.detail && (
                      <span className="mt-2 line-clamp-3 whitespace-pre-wrap text-xs text-base-content/60">
                        {card.detail}
                      </span>
                    )}
                    <span className="mt-3 block text-xs font-medium text-primary">
                      {card.kind === "draft"
                        ? "Open article & review →"
                        : "Open task →"}
                    </span>
                  </button>
                  <div className="mt-3 border-t border-base-200 pt-2">
                    {card.kind === "task" ? (
                      <label className="flex items-center justify-between gap-2 text-xs">
                        Move to
                        <select
                          aria-label={`Move ${card.title}`}
                          className="select select-bordered select-xs border border-base-300 bg-base-200 text-base-content max-w-36"
                          value={card.stage}
                          disabled={moving}
                          onChange={(event) =>
                            move(card.id, stageSchema.parse(event.target.value))
                          }
                        >
                          {Object.entries(BOARD_STAGES).map(
                            ([value, title]) => (
                              <option
                                className="bg-base-200 text-base-content"
                                key={value}
                                value={value}
                              >
                                {title}
                              </option>
                            ),
                          )}
                        </select>
                      </label>
                    ) : (
                      <label className="flex items-center justify-between gap-2 text-xs">
                        Priority
                        <select
                          aria-label={`Priority for ${card.title}`}
                          className="select select-bordered select-xs border border-base-300 bg-base-200 text-base-content max-w-32"
                          value={card.priority}
                          disabled={prioritizing}
                          onChange={(event) =>
                            onPrioritize({
                              jobId: card.id,
                              priority: prioritySchema.parse(
                                event.target.value,
                              ),
                              expectedPriority: card.priority,
                            })
                          }
                        >
                          {Object.entries(TASK_PRIORITIES).map(
                            ([value, title]) => (
                              <option
                                className="bg-base-200 text-base-content"
                                key={value}
                                value={value}
                              >
                                {title}
                              </option>
                            ),
                          )}
                        </select>
                      </label>
                    )}
                  </div>
                  {card.kind === "draft" && (
                    <p className="mt-2 text-[11px] text-base-content/45">
                      Stage follows generation and approval.
                    </p>
                  )}
                </article>
              ))}
              {!column.length && (
                <p className="rounded-lg border border-dashed border-base-300 p-4 text-center text-xs text-base-content/45">
                  No items
                </p>
              )}
            </div>
          </section>
        );
      })}
    </div>
  );
}
