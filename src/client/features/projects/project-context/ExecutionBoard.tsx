import {
  ArticleFollowUpPanel,
  PublicationFollowUpSummary,
  type ArticleFollowUp,
} from "./ArticleFollowUpPanel";
import { sort } from "remeda";
import { TaskEditor } from "./ExecutionTaskEditor";
import { ExecutionLanes, type Card } from "./ExecutionLanes";
import { useState, useEffect, useRef } from "react";
import { Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Plus, Settings2 } from "lucide-react";
import { toast } from "sonner";
import {
  getAutomation,
  updateExecutionTask,
  prioritizeExecutionDraft,
} from "@/serverFunctions/automation";
import {
  TASK_CATEGORIES,
  priorityRank,
  draftBoardStage,
  categorySchema,
  type TaskPriority,
  type TaskCategory,
  type BoardStage,
} from "@/types/schemas/executionBoard";
import { getStandardErrorMessage } from "@/client/lib/error-messages";
import { Draft } from "./AutomationDraft";
import { ContentDraftForm } from "./ContentDraftForm";

type Task = Awaited<ReturnType<typeof getAutomation>>["tasks"][number];
export function ExecutionBoard({
  projectId,
  topic,
  targetUrl,
}: {
  projectId: string;
  topic?: string;
  targetUrl?: string;
}) {
  const client = useQueryClient(),
    key = ["automation", projectId];
  const query = useQuery({
    queryKey: key,
    queryFn: () => getAutomation({ data: { projectId } }),
    refetchInterval: 5000,
  });
  const [category, setCategory] = useState<TaskCategory | "all">("all"),
    [onlyCritical, setOnlyCritical] = useState(false),
    [editor, setEditor] = useState<Task | "new" | null>(null),
    [draftId, setDraftId] = useState<string>(),
    [generating, setGenerating] = useState(!!topic);
  const refresh = () => client.invalidateQueries({ queryKey: key });
  const update = useMutation({
    mutationFn: (data: Task) =>
      updateExecutionTask({
        data: {
          projectId,
          id: data.id,
          expectedVersion: data.version,
          title: data.title,
          description: data.description,
          category: data.category,
          priority: data.priority,
          state: data.state,
        },
      }),
    onSuccess: () => void refresh(),
    onError: (error) =>
      toast.error(
        getStandardErrorMessage(
          error,
          "Task changed elsewhere. Reload before moving it.",
        ),
      ),
  });
  const prioritize = useMutation({
    mutationFn: (data: {
      jobId: string;
      priority: TaskPriority;
      expectedPriority: TaskPriority;
    }) => prioritizeExecutionDraft({ data: { projectId, ...data } }),
    onSuccess: () => void refresh(),
    onError: (error) =>
      toast.error(getStandardErrorMessage(error, "Could not update priority.")),
  });
  if (query.isPending)
    return (
      <p className="p-6" role="status">
        Loading execution board…
      </p>
    );
  if (query.isError)
    return (
      <p className="p-6" role="alert">
        {getStandardErrorMessage(
          query.error,
          "Could not load execution board.",
        )}
      </p>
    );
  const data = query.data;
  const cards: Card[] = [
    ...data.tasks.map((task) => ({
      id: task.id,
      title: task.title,
      category: task.category,
      priority: task.priority,
      stage: task.state,
      kind: "task" as const,
      detail: task.description,
    })),
    ...data.jobs.map((job) => ({
      id: job.id,
      title: job.topic,
      category: "content" as const,
      priority: job.priority,
      stage: draftBoardStage(job.state),
      kind: "draft" as const,
      detail: job.message ?? job.rationale ?? job.state.replaceAll("_", " "),
    })),
  ];
  const critical = cards.filter(
    (card) => card.priority === "critical" && card.stage !== "done",
  ).length;
  const visible = sort(
    cards.filter(
      (card) =>
        (category === "all" || card.category === category) &&
        (!onlyCritical || card.priority === "critical"),
    ),
    (a, b) =>
      priorityRank[a.priority] - priorityRank[b.priority] ||
      a.title.localeCompare(b.title),
  );
  const move = (id: string, state: BoardStage) => {
    const task = data.tasks.find((row) => row.id === id);
    if (task && !update.isPending && task.state !== state)
      update.mutate({ ...task, state });
  };
  return (
    <main className="h-full overflow-auto bg-base-100 p-4 md:p-6 space-y-5">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-wider text-base-content/50">
            Project workspace
          </p>
          <h1 className="text-2xl font-semibold">Execution</h1>
          <p className="mt-1 text-sm text-base-content/60">
            Prioritize work across content, technical SEO and ongoing
            improvements.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            className="btn btn-ghost btn-sm"
            to="/p/$projectId/settings/automation"
            params={{ projectId }}
          >
            <Settings2 size={16} />
            Execution settings
          </Link>
          <button
            className="btn btn-outline btn-sm"
            onClick={() => setGenerating((value) => !value)}
          >
            Generate content draft
          </button>
          <button
            className="btn btn-primary btn-sm"
            onClick={() => setEditor("new")}
          >
            <Plus size={16} />
            Add task
          </button>
        </div>
      </header>
      {critical > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-error/40 bg-error/5 p-3">
          <div className="flex items-center gap-2">
            <AlertTriangle size={18} className="text-error" />
            <span className="font-medium">
              {critical} critical{" "}
              {critical === 1 ? "issue needs" : "issues need"} attention
            </span>
          </div>
          <button
            className="btn btn-sm btn-ghost"
            onClick={() => {
              setOnlyCritical(true);
              setCategory("all");
            }}
          >
            Show critical work
          </button>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-sm">
          Category
          <select
            className="select select-bordered select-sm"
            value={category}
            onChange={(event) =>
              setCategory(
                event.target.value === "all"
                  ? "all"
                  : categorySchema.parse(event.target.value),
              )
            }
          >
            <option value="all">All categories</option>
            {Object.entries(TASK_CATEGORIES).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="checkbox checkbox-sm"
            checked={onlyCritical}
            onChange={(event) => setOnlyCritical(event.target.checked)}
          />
          Critical only
        </label>
        <span className="text-xs text-base-content/50">
          {visible.length} items · highest priority first
        </span>
      </div>
      {data.tasksTruncated && (
        <p role="status" className="text-sm">
          Showing the latest 500 tasks. Older tasks remain saved.
        </p>
      )}
      {generating && (
        <section className="max-w-2xl rounded-lg border border-base-300 p-4">
          <ContentDraftForm
            projectId={projectId}
            topic={topic}
            targetUrl={targetUrl}
            policy={data.policy}
            onCreated={(id) => {
              setDraftId(id);
              setGenerating(false);
              void refresh();
            }}
          />
        </section>
      )}
      <ExecutionLanes
        visible={visible}
        move={move}
        moving={update.isPending}
        prioritizing={prioritize.isPending}
        onOpen={(card) =>
          card.kind === "draft"
            ? setDraftId(card.id)
            : setEditor(data.tasks.find((task) => task.id === card.id) ?? null)
        }
        onPrioritize={(input) => prioritize.mutate(input)}
      />
      <PublicationFollowUpSummary
        rows={data.followUps}
        jobs={data.jobs}
        onOpen={setDraftId}
      />
      {editor && (
        <TaskEditor
          key={editor === "new" ? "new" : editor.id + editor.version}
          projectId={projectId}
          task={editor === "new" ? undefined : editor}
          onClose={() => setEditor(null)}
          onSaved={() => {
            setEditor(null);
            void refresh();
          }}
        />
      )}
      {draftId && (
        <DraftDialog
          projectId={projectId}
          jobId={draftId}
          followUps={data.followUps.filter((row) => row.jobId === draftId)}
          onOpenTask={(id) => {
            const task = data.tasks.find((item) => item.id === id);
            if (task) {
              setDraftId(undefined);
              setEditor(task);
            } else
              toast.info(
                "This task is outside the latest 500 tasks shown on the board.",
              );
          }}
          onClose={() => setDraftId(undefined)}
          onChanged={refresh}
        />
      )}
    </main>
  );
}

function DraftDialog({
  projectId,
  jobId,
  followUps,
  onOpenTask,
  onClose,
  onChanged,
}: {
  projectId: string;
  jobId: string;
  followUps: ArticleFollowUp[];
  onOpenTask: (id: string) => void;
  onClose: () => void;
  onChanged: () => Promise<unknown>;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const requestClose = () => {
    if (
      dialog.current?.querySelector('[data-review-dirty="true"]') &&
      !window.confirm("Discard unsaved review changes?")
    )
      return;
    onClose();
  };
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => element?.close();
  }, []);
  return (
    <dialog
      ref={dialog}
      aria-labelledby="article-review-dialog-title"
      onCancel={(event) => {
        event.preventDefault();
        requestClose();
      }}
      onClick={(event) => {
        if (event.target !== event.currentTarget) return;
        const bounds = event.currentTarget.getBoundingClientRect();
        if (
          event.clientX < bounds.left ||
          event.clientX > bounds.right ||
          event.clientY < bounds.top ||
          event.clientY > bounds.bottom
        )
          requestClose();
      }}
      className="m-auto max-h-[90dvh] w-[calc(100%-2rem)] max-w-4xl overflow-y-auto rounded-xl border border-base-300 bg-base-100 p-5 text-base-content shadow-xl backdrop:bg-black/60"
    >
      <header className="mb-4 flex items-center justify-between gap-3">
        <h2 id="article-review-dialog-title" className="text-lg font-semibold">
          Article review
        </h2>
        <button
          type="button"
          className="btn btn-sm bg-base-200"
          onClick={requestClose}
        >
          Close draft
        </button>
      </header>
      <ArticleFollowUpPanel
        rows={followUps}
        onOpenTask={onOpenTask}
        projectId={projectId}
        onChanged={onChanged}
      />
      <Draft
        key={jobId}
        projectId={projectId}
        jobId={jobId}
        onChanged={onChanged}
      />
    </dialog>
  );
}
