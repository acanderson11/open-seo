import type { getAutomationDraft } from "@/serverFunctions/automation";
type History = NonNullable<
  Awaited<ReturnType<typeof getAutomationDraft>>
>["history"];
export function ArticleFeedbackHistory({
  history,
  currentVersion,
}: {
  history: History;
  currentVersion: number;
}) {
  const previousVersions = history.revisions.filter(
    (item) => item.artifactVersion < currentVersion,
  );
  return (
    <>
      {!!history.feedback.length && (
        <details className="border-t border-base-300 pt-4">
          <summary className="cursor-pointer font-semibold">
            Feedback history ({history.feedback.length})
          </summary>
          <div className="mt-3 space-y-2">
            {history.feedback.map((item) => (
              <div
                key={item.id}
                className="rounded border border-base-300 p-3 text-sm"
              >
                <p className="font-medium">
                  Version {item.artifactVersion} · {item.role} · {item.scope} ·{" "}
                  {new Date(item.createdAt).toLocaleDateString()}
                </p>
                <p className="whitespace-pre-wrap">{item.message}</p>
                {item.passages.map((p) => (
                  <div
                    key={p.id}
                    className="mt-3 border-l-2 border-primary pl-3"
                  >
                    <p className="font-medium">Passage {p.blockIndex + 1}</p>
                    <blockquote className="mt-1 text-base-content/70">
                      “{p.quote}”
                    </blockquote>
                    <p className="mt-2 whitespace-pre-wrap">{p.message}</p>
                  </div>
                ))}
                {item.instruction && (
                  <p className="mt-2">Instruction: {item.instruction}</p>
                )}
              </div>
            ))}
          </div>
        </details>
      )}
      {!!previousVersions.length && (
        <section className="space-y-2">
          <h4 className="font-semibold">Previous article versions</h4>
          {previousVersions.map((item) => (
            <details
              key={item.id}
              className="rounded border border-base-300 p-3"
            >
              <summary className="cursor-pointer text-sm">
                Previous version {item.artifactVersion} — {item.title}
              </summary>
              <div
                className="article-content mt-3"
                dangerouslySetInnerHTML={{ __html: item.bodyHtml ?? "" }}
              />
            </details>
          ))}
        </section>
      )}
    </>
  );
}

export function RevisionPendingNotice({
  state,
  version,
}: {
  state: string;
  version: number;
}) {
  return (
    <div
      className="rounded border border-warning/50 bg-warning/10 p-3 text-sm"
      role="status"
    >
      <p className="font-semibold">
        {state === "revision_queued" || state === "revising"
          ? "Revision pending"
          : "Revision has not been generated"}
      </p>
      <p>
        Your feedback on version {version} is saved. No new article version has
        been generated from it yet. The article shown here is the version you
        reviewed.
      </p>
      {state === "needs_revision" && (
        <p className="mt-2">
          You can edit the saved comments beside each passage or choose “Revise
          using feedback” below. Feedback history keeps a record of what you
          submitted for each version.
        </p>
      )}
    </div>
  );
}
