import { Draft } from "./AutomationDraft";
import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createSeoBrief,
  createBriefDraft,
  listSeoBriefs,
  readSeoBrief,
} from "@/serverFunctions/seoBriefs";
import { getStandardErrorMessage } from "@/client/lib/error-messages";
export function SeoBriefs({ projectId }: { projectId: string }) {
  const client = useQueryClient();
  const [topic, setTopic] = useState(""),
    [includeSerp, setIncludeSerp] = useState(true),
    [selected, setSelected] = useState<string | null>(null);
  const request = useRef<{ signature: string; key: string } | null>(null);
  const mutation = useMutation({
    mutationFn: () => {
      const signature = JSON.stringify({ topic: topic.trim(), includeSerp });
      if (request.current?.signature !== signature)
        request.current = { signature, key: crypto.randomUUID() };
      return createSeoBrief({
        data: {
          projectId,
          topic: topic.trim(),
          includeSerp,
          requestKey: request.current.key,
        },
      });
    },
    onSuccess: async (result) => {
      if (result) {
        setSelected(result.id);
        if (result.state !== "running") request.current = null;
      }
      await client.invalidateQueries({ queryKey: ["seo-briefs", projectId] });
      await client.invalidateQueries({ queryKey: ["seo-brief", projectId] });
    },
  });
  const list = useQuery({
    queryKey: ["seo-briefs", projectId],
    queryFn: () => listSeoBriefs({ data: { projectId } }),
    refetchInterval: mutation.isPending ? 5000 : false,
  });
  return (
    <section className="space-y-4" aria-labelledby="seo-briefs-heading">
      <div>
        <h2 id="seo-briefs-heading" className="text-lg font-semibold">
          Investigations & content briefs
        </h2>
        <p className="text-sm text-base-content/70 mt-2">
          Review a topic against this site's context, feedback, existing pages
          and analytics. Save an AI proposal with evidence and questions for the
          client. A brief does not start an article or publish anything.
        </p>
      </div>
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          mutation.mutate();
        }}
      >
        <label className="block text-sm">
          Topic or opportunity to investigate
          <input
            className="input input-bordered w-full mt-1"
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            minLength={3}
            maxLength={300}
            required
            disabled={mutation.isPending}
            placeholder="e.g. When should a service business redesign its website?"
          />
        </label>
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            className="checkbox checkbox-sm"
            checked={includeSerp}
            disabled={mutation.isPending}
            onChange={(e) => setIncludeSerp(e.target.checked)}
          />
          <span>
            Include one live Google search (top 10 results, using the project's
            market). Uses the existing research provider and may incur its
            normal charge.
          </span>
        </label>
        <div className="flex flex-wrap gap-3 items-center">
          <button
            className="btn btn-primary btn-sm"
            disabled={mutation.isPending || topic.trim().length < 3}
          >
            {mutation.isPending ? "Investigating…" : "Investigate & save brief"}
          </button>
          <span className="text-xs text-base-content/60">
            Uses the configured OpenSEO AI model. One investigation per project
            at a time; up to 20 per UTC day.
          </span>
        </div>
        {mutation.isPending && (
          <p role="status" className="text-sm">
            Gathering evidence and preparing the brief. This can take up to two
            minutes.
          </p>
        )}
        {mutation.isError && (
          <p role="alert" className="text-error text-sm">
            {getStandardErrorMessage(
              mutation.error,
              "Could not confirm the investigation. Check saved investigations before retrying.",
            )}
          </p>
        )}
      </form>
      {list.isPending && <p role="status">Loading saved investigations…</p>}
      {list.isError && (
        <button
          className="btn btn-outline btn-sm"
          onClick={() => void list.refetch()}
        >
          Retry loading saved investigations
        </button>
      )}
      {list.data?.length === 0 && (
        <p className="text-sm text-base-content/60">
          No saved investigations yet.
        </p>
      )}
      <div className="divide-y divide-base-300">
        {list.data?.map((brief) => (
          <div className="py-3" key={brief.id}>
            <button
              className="text-left w-full hover:text-primary"
              aria-expanded={selected === brief.id}
              onClick={() =>
                setSelected(selected === brief.id ? null : brief.id)
              }
            >
              <span className="font-medium">{brief.title || brief.topic}</span>
              <span className="block text-xs text-base-content/60 mt-1">
                {brief.state.replaceAll("_", " ")} ·{" "}
                {new Date(brief.createdAt).toLocaleString()}
                {brief.action ? " · " + brief.action.replaceAll("_", " ") : ""}
              </span>
            </button>
            {selected === brief.id && (
              <SavedBrief key={brief.id} projectId={projectId} id={brief.id} />
            )}
          </div>
        ))}
      </div>
      {list.data?.length === 50 && (
        <p className="text-xs">Showing the 50 most recent investigations.</p>
      )}
    </section>
  );
}
function SavedBrief({ projectId, id }: { projectId: string; id: string }) {
  const client = useQueryClient();
  const createDraft = useMutation({
    mutationFn: () => createBriefDraft({ data: { projectId, id } }),
    onSuccess: () =>
      client.invalidateQueries({ queryKey: ["automation", projectId] }),
  });
  const query = useQuery({
    queryKey: ["seo-brief", projectId, id],
    queryFn: () => readSeoBrief({ data: { projectId, id } }),
    refetchInterval: (q) => (q.state.data?.state === "running" ? 5000 : false),
  });
  if (query.isPending)
    return (
      <p role="status" className="mt-3">
        Reading brief…
      </p>
    );
  if (query.isError)
    return (
      <button
        className="btn btn-outline btn-sm mt-3"
        onClick={() => void query.refetch()}
      >
        Retry opening brief
      </button>
    );
  const brief = query.data;
  return (
    <div className="mt-4 space-y-4 text-sm">
      <p
        className={
          brief.state === "failed" ? "text-error" : "text-base-content/70"
        }
      >
        {brief.message ||
          "Investigation in progress. If interrupted, you can start a new investigation after ten minutes."}
      </p>
      {brief.contextChanged && (
        <p role="alert" className="text-warning">
          Client context or feedback has changed since this brief was created.
          Re-investigate before using it.
        </p>
      )}
      {brief.state === "saved" && (
        <>
          <div className="space-y-2 border-y border-base-300 py-3">
            <button
              className="btn btn-primary btn-sm"
              disabled={
                createDraft.isPending ||
                brief.contextChanged ||
                brief.action === "no_action"
              }
              onClick={() => createDraft.mutate()}
            >
              {createDraft.isPending
                ? "Writing and reviewing…"
                : "Create article draft from this brief"}
            </button>
            <p>
              Writes the article, then has it independently reviewed and
              corrected once if needed. One draft per brief; repeat clicks
              reopen the same job. Unanswered research questions are optional
              and do not prevent review or approval.
            </p>
            {createDraft.isError && (
              <p role="alert" className="text-error">
                {getStandardErrorMessage(
                  createDraft.error,
                  "Draft could not be confirmed. Check the execution board before retrying.",
                )}
              </p>
            )}
            {createDraft.data && (
              <Draft
                projectId={projectId}
                jobId={createDraft.data.id}
                onChanged={() =>
                  client.invalidateQueries({
                    queryKey: ["automation", projectId],
                  })
                }
              />
            )}
          </div>
          <p className="text-base-content/60">
            AI proposal · {brief.confidence} confidence · {brief.model}.
            Supporting quotes are checked against the saved evidence;
            interpretations still need review.
          </p>
          {brief.targetUrl && (
            <p>
              Existing page:{" "}
              <a
                className="link break-all"
                href={brief.targetUrl}
                target="_blank"
                rel="noreferrer"
              >
                {brief.targetUrl}
              </a>
            </p>
          )}
          <dl className="grid gap-3 sm:grid-cols-2">
            {[
              ["Audience", brief.audience],
              ["Search intent", brief.intent],
              ["Distinctive angle", brief.angle],
              ["Why this work", brief.rationale],
              ["Success measure", brief.successMeasure],
            ].map(([label, value]) => (
              <div key={label}>
                <dt className="font-semibold">{label}</dt>
                <dd className="mt-1 whitespace-pre-wrap">{value}</dd>
              </div>
            ))}
          </dl>
          <BriefItems
            brief={brief}
            kind="finding"
            title="Findings & supporting evidence"
          />
          <BriefItems brief={brief} kind="outline" title="Proposed outline" />
          <BriefItems
            brief={brief}
            kind="gap"
            title="Optional research & limitations"
          />
          <BriefItems
            brief={brief}
            kind="expert_question"
            title="Questions for real client expertise"
          />
          <details>
            <summary className="cursor-pointer font-semibold">
              Saved evidence ({brief.sources.length} sources)
            </summary>
            <div className="space-y-4 mt-3">
              {brief.sources.map((source) => (
                <div key={source.id} id={"brief-" + brief.id + "-" + source.id}>
                  <h4 className="font-medium">
                    {source.id}: {source.title}
                  </h4>
                  <p className="text-xs text-base-content/60">
                    {source.kind} · captured/read {source.observedAt}
                  </p>
                  {source.url && (
                    <a
                      className="link break-all"
                      href={source.url}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {source.url}
                    </a>
                  )}
                  <p className="whitespace-pre-wrap break-words mt-2">
                    {source.content}
                  </p>
                </div>
              ))}
            </div>
          </details>
        </>
      )}
    </div>
  );
}
type Brief = Awaited<ReturnType<typeof readSeoBrief>>;
function BriefItems({
  brief,
  kind,
  title,
}: {
  brief: Brief;
  kind: string;
  title: string;
}) {
  const items = brief.sections.filter((item) => item.kind === kind);
  if (!items.length) return null;
  return (
    <section>
      <h3 className="font-semibold">{title}</h3>
      <ol className="mt-2 space-y-3 list-decimal pl-5">
        {items.map((item) => {
          const source = brief.sources.find((s) => s.id === item.evidenceId);
          return (
            <li key={item.id}>
              {item.heading && <h4 className="font-medium">{item.heading}</h4>}
              <p className="whitespace-pre-wrap">{item.detail}</p>
              {source && (
                <p className="text-xs text-base-content/60 mt-1">
                  Source {source.id}: {source.title} · {source.observedAt}
                </p>
              )}
              {item.quote && (
                <blockquote className="border-l-2 border-base-300 pl-3 mt-2 text-base-content/70 whitespace-pre-wrap">
                  {item.quote}
                </blockquote>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
