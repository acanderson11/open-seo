import { sort } from "remeda";
import {
  retryArticleFollowUp,
  type getAutomation,
} from "@/serverFunctions/automation";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { getStandardErrorMessage } from "@/client/lib/error-messages";

type FollowUp = Awaited<ReturnType<typeof getAutomation>>["followUps"][number];
export type ArticleFollowUp = FollowUp;
const stages: Record<string, string> = {
  technical: "Page and sitemap check",
  indexing_3: "Indexing · day 3",
  indexing_7: "Indexing · day 7",
  metrics_14: "Search performance · day 14",
  metrics_30: "Search performance · day 30",
  reassess_60: "Performance review · day 60",
  reassess_90: "Performance review · day 90",
};
function dateLabel(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "Date unavailable"
    : date.toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric",
      });
}
export function ArticleFollowUpPanel({
  rows,
  onOpenTask,
  projectId,
  onChanged,
}: {
  rows: FollowUp[];
  onOpenTask: (id: string) => void;
  projectId: string;
  onChanged: () => Promise<unknown>;
}) {
  const retry = useMutation({
    mutationFn: (id: string) =>
      retryArticleFollowUp({ data: { projectId, id } }),
    onSuccess: () => {
      toast.success("Check queued. It will run automatically shortly.");
      void onChanged();
    },
    onError: (error) =>
      toast.error(
        getStandardErrorMessage(
          error,
          "Could not retry this check. Refresh and try again.",
        ),
      ),
  });
  if (!rows.length) return null;
  return (
    <section
      className="mb-4 rounded-lg border border-base-300 bg-base-200/30 p-4"
      aria-label="Publication follow-ups"
    >
      <h3 className="font-semibold">Publication follow-ups</h3>
      <p className="mt-1 text-sm text-base-content/70">
        This article stays Done. Checks run automatically; indexing and search
        results take time.
      </p>
      {rows.some((row) => row.scheduleBasis === "monitoring") && (
        <p className="mt-2 text-xs text-base-content/60">
          This article was published before monitoring was added. Day numbers
          start when monitoring began because its original publication date was
          not recorded.
        </p>
      )}
      <ol className="mt-3 divide-y divide-base-300">
        {rows.map((row) => (
          <li key={row.id} className="py-3 first:pt-0 last:pb-0">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-sm font-medium">
                {stages[row.stage] ?? row.stage.replaceAll("_", " ")}
              </span>
              <span className="text-xs text-base-content/70">
                {row.state === "running"
                  ? "Checking now"
                  : row.state === "pending"
                    ? `${row.checkedAt ? "Retry" : "Scheduled"} ${dateLabel(row.dueAt)}`
                    : row.checkedAt
                      ? `Checked ${dateLabel(row.checkedAt)}`
                      : "Awaiting check"}
              </span>
            </div>
            {row.detail && (
              <p className="mt-1 text-sm text-base-content/70">{row.detail}</p>
            )}
            {row.state === "unavailable" && (
              <p className="mt-1 text-xs text-base-content/60">
                Could not verify. This does not mean the article failed.
              </p>
            )}
            {row.state === "unavailable" && (
              <button
                type="button"
                className="btn btn-sm btn-outline mt-2"
                disabled={retry.isPending}
                onClick={() => retry.mutate(row.id)}
              >
                Retry check
              </button>
            )}
            {row.taskId && (
              <button
                type="button"
                className="btn btn-sm btn-outline mt-2"
                onClick={() => onOpenTask(row.taskId!)}
              >
                View follow-up task
              </button>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}

export function PublicationFollowUpSummary({
  rows,
  jobs,
  onOpen,
}: {
  rows: FollowUp[];
  jobs: { id: string; topic: string; state: string }[];
  onOpen: (id: string) => void;
}) {
  const published = jobs.filter((job) => job.state === "published");
  if (!published.length) return null;
  return (
    <details className="rounded-lg border border-base-300 bg-base-100 p-4">
      <summary className="cursor-pointer font-medium">
        Publication follow-ups{" "}
        <span className="ml-1 font-normal text-base-content/60">
          · {published.length} {published.length === 1 ? "article" : "articles"}
        </span>
      </summary>
      <p className="mt-2 text-sm text-base-content/70">
        Automatic page checks, indexing checks and performance reviews. Open an
        article to see its schedule and results.
      </p>
      <ul className="mt-3 divide-y divide-base-300">
        {published.map((job) => {
          const checks = rows.filter((row) => row.jobId === job.id);
          const next = sort(
            checks.filter(
              (row) => row.state === "pending" || row.state === "running",
            ),
            (a, b) => a.dueAt.localeCompare(b.dueAt),
          )[0];
          const task = checks.some((row) => !!row.taskId);
          return (
            <li
              key={job.id}
              className="flex flex-wrap items-center justify-between gap-2 py-2"
            >
              <button
                type="button"
                className="link text-left text-sm font-medium"
                onClick={() => onOpen(job.id)}
              >
                {job.topic}
              </button>
              <span className="text-xs text-base-content/60">
                {task ? "Follow-up task created · " : ""}
                {next
                  ? `Next: ${dateLabel(next.dueAt)}`
                  : checks.length
                    ? "Checks finished · view results"
                    : "Schedule preparing"}
              </span>
            </li>
          );
        })}
      </ul>
    </details>
  );
}
