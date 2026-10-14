import { useState, useRef, useEffect } from "react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  createExecutionTask,
  updateExecutionTask,
  type getAutomation,
} from "@/serverFunctions/automation";
import {
  BOARD_STAGES,
  TASK_CATEGORIES,
  TASK_PRIORITIES,
  categorySchema,
  prioritySchema,
  stageSchema,
  type TaskPriority,
  type TaskCategory,
  type BoardStage,
} from "@/types/schemas/executionBoard";
import { getStandardErrorMessage } from "@/client/lib/error-messages";
type Task = Awaited<ReturnType<typeof getAutomation>>["tasks"][number];
export function TaskEditor({
  projectId,
  task,
  onClose,
  onSaved,
}: {
  projectId: string;
  task?: Task;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [title, setTitle] = useState(task?.title ?? ""),
    [description, setDescription] = useState(task?.description ?? ""),
    [category, setCategory] = useState<TaskCategory>(
      task?.category ?? "technical",
    ),
    [priority, setPriority] = useState<TaskPriority>(
      task?.priority ?? "normal",
    ),
    [state, setState] = useState<BoardStage>(task?.state ?? "todo"),
    [requestKey] = useState(() => crypto.randomUUID());
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => element?.close();
  }, []);
  const save = useMutation({
    mutationFn: () =>
      task
        ? updateExecutionTask({
            data: {
              projectId,
              id: task.id,
              expectedVersion: task.version,
              title,
              description,
              category,
              priority,
              state,
            },
          })
        : createExecutionTask({
            data: {
              projectId,
              requestKey,
              title,
              description,
              category,
              priority,
              state,
            },
          }),
    onSuccess: onSaved,
    onError: (error) =>
      toast.error(
        getStandardErrorMessage(
          error,
          "Could not save task. Your edits are still here.",
        ),
      ),
  });
  return (
    <dialog
      ref={dialog}
      onCancel={(event) => {
        event.preventDefault();
        if (!save.isPending) onClose();
      }}
      aria-labelledby="execution-task-title"
      className="m-auto max-h-[90dvh] w-[calc(100%-2rem)] max-w-xl overflow-y-auto rounded-xl bg-base-100 p-5 text-base-content shadow-xl backdrop:bg-black/40"
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (!save.isPending) save.mutate();
        }}
        className="space-y-4"
      >
        <h2 id="execution-task-title" className="text-lg font-semibold">
          {task ? "Edit task" : "Add task"}
        </h2>
        <label className="block text-sm">
          Title
          <input
            autoFocus
            className="input input-bordered w-full"
            required
            minLength={3}
            maxLength={180}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
          />
        </label>
        <label className="block text-sm">
          Details
          <textarea
            className="textarea textarea-bordered w-full min-h-28"
            maxLength={4000}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
          />
        </label>
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="text-sm">
            Category
            <select
              className="select select-bordered w-full"
              value={category}
              onChange={(event) =>
                setCategory(categorySchema.parse(event.target.value))
              }
            >
              {Object.entries(TASK_CATEGORIES).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            Priority
            <select
              className="select select-bordered w-full"
              value={priority}
              onChange={(event) =>
                setPriority(prioritySchema.parse(event.target.value))
              }
            >
              {Object.entries(TASK_PRIORITIES).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            Stage
            <select
              className="select select-bordered w-full"
              value={state}
              onChange={(event) =>
                setState(stageSchema.parse(event.target.value))
              }
            >
              {Object.entries(BOARD_STAGES).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            disabled={save.isPending}
            onClick={onClose}
          >
            Cancel
          </button>
          <button className="btn btn-primary btn-sm" disabled={save.isPending}>
            {save.isPending ? "Saving…" : "Save task"}
          </button>
        </div>
      </form>
    </dialog>
  );
}
