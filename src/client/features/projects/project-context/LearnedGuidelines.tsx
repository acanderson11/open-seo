import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  getContentGuidelines,
  setContentGuideline,
} from "@/serverFunctions/automation";
export function LearnedGuidelines({ projectId }: { projectId: string }) {
  const client = useQueryClient(),
    key = ["content-guidelines", projectId];
  const query = useQuery({
    queryKey: key,
    queryFn: () => getContentGuidelines({ data: { projectId } }),
  });
  const update = useMutation({
    mutationFn: (data: {
      id: string;
      version: number;
      status: "active" | "disabled";
    }) => setContentGuideline({ data: { projectId, ...data } }),
    onSuccess: () => void client.invalidateQueries({ queryKey: key }),
    onError: () => toast.error("Guideline changed. Refresh and try again."),
  });
  if (query.isError)
    return (
      <p className="text-sm" role="alert">
        Learned guidelines are unavailable for this account.
      </p>
    );
  return (
    <section className="space-y-3 border-t border-base-300 pt-5">
      <h2 className="text-lg font-semibold">Learned guidelines</h2>
      <p className="text-sm text-base-content/70">
        Preferences saved from article reviews supplement this client’s Context
        in content automation. Article-only edits stay with the article.
        Proposed rules are not used until you resolve them. Disable a rule to
        stop applying it; its source is preserved.
      </p>
      {query.isPending ? (
        <p>Loading guidelines…</p>
      ) : !query.data?.length ? (
        <p className="text-sm">
          No learned guidelines yet. Save a lasting preference when requesting
          an article revision.
        </p>
      ) : (
        query.data.slice(0, 100).map(({ rule, feedback }) => (
          <article
            key={rule.id}
            className="space-y-2 rounded-lg border border-base-300 p-4"
          >
            <div className="flex flex-wrap justify-between gap-2">
              <strong>
                {rule.category} · {rule.status}
              </strong>
              <span className="text-xs">Guideline version {rule.version}</span>
            </div>
            <p className="whitespace-pre-wrap">{rule.instruction}</p>
            {rule.status === "proposed" && (
              <p className="text-sm">
                Check this against the client’s Context and existing rules.
                Factual corrections need an authoritative source. Disable
                conflicting rules before activating this one.
              </p>
            )}
            <details className="text-sm">
              <summary className="cursor-pointer">
                Source: {feedback.role} feedback on article version{" "}
                {feedback.artifactVersion}
              </summary>
              <p className="whitespace-pre-wrap">{feedback.message}</p>
              <p>
                Article: {feedback.jobId} ·{" "}
                {new Date(feedback.createdAt).toLocaleDateString()}
              </p>
            </details>
            <button
              className="btn btn-sm"
              disabled={update.isPending}
              onClick={() =>
                update.mutate({
                  id: rule.id,
                  version: rule.version,
                  status:
                    rule.status === "active" || feedback.scope === "fact"
                      ? "disabled"
                      : "active",
                })
              }
            >
              {feedback.scope === "fact"
                ? "Dismiss after updating verified facts in Context"
                : rule.status === "active"
                  ? "Disable guideline"
                  : "Activate after review"}
            </button>
          </article>
        ))
      )}
      {query.data && query.data.length > 100 && (
        <p role="status">
          Showing the first 100 guidelines. Consolidate guidance before adding
          more.
        </p>
      )}
    </section>
  );
}
