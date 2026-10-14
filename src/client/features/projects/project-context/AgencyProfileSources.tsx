import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { previewAgencyQuestionnaires } from "@/serverFunctions/agencyProfile";
import { questionnaireContextSuggestions } from "@/types/schemas/agencyQuestionnaireContext";
import {
  PROJECT_CONTEXT_SECTION_LABELS,
  PROSE_MAX_CHARS,
  type ProjectContextSectionKey,
} from "@/types/schemas/projectContext";
import { getStandardErrorMessage } from "@/client/lib/error-messages";

export function AgencyProfileSources({
  projectId,
  disabled,
  canUse,
  onUse,
}: {
  projectId: string;
  disabled: boolean;
  canUse: (key: ProjectContextSectionKey) => boolean;
  onUse: (key: ProjectContextSectionKey, value: string) => void;
}) {
  const [selectedId, setSelectedId] = useState<number>();
  const query = useMutation({
    mutationFn: () => previewAgencyQuestionnaires({ data: { projectId } }),
  });
  const selected = query.data?.records.find((row) => row.id === selectedId);
  const busy = disabled || query.isPending;
  return (
    <details className="rounded-lg border border-base-300 p-4 space-y-3">
      <summary className="cursor-pointer font-medium">
        Import client questionnaire
      </summary>
      <p className="text-sm text-base-content/70">
        Use Customers answers first, then ask SAM to draft missing context from
        the website. Review these answers before saving. Existing context and
        unsaved edits are preserved.
      </p>
      <button
        type="button"
        className="btn btn-sm btn-outline"
        disabled={busy}
        onClick={() => {
          setSelectedId(undefined);
          query.mutate();
        }}
      >
        {query.isPending ? "Finding answers…" : "Find questionnaire"}
      </button>
      {query.isError && (
        <p role="alert">
          {getStandardErrorMessage(
            query.error,
            "Could not load questionnaire answers.",
          )}
        </p>
      )}
      {query.data?.connected === false && (
        <p role="status">The Customers connection has not been configured.</p>
      )}
      {query.data?.connected && !query.data.records.length && (
        <p>No questionnaire matches this project's website.</p>
      )}
      {query.data?.records.map((row) => (
        <button
          key={row.id}
          type="button"
          className="btn btn-sm btn-ghost block"
          disabled={busy}
          onClick={() => setSelectedId(row.id)}
        >
          Review {row.name} · row {row.id}
        </button>
      ))}
      {selected && (
        <div className="space-y-3" aria-live="polite">
          {selected.warnings.map((warning, i) => (
            <p key={i} className="text-sm">
              {warning}
            </p>
          ))}
          {questionnaireContextSuggestions(selected.suggestions).map((item) => (
            <div
              key={item.section}
              className="space-y-2 border-t border-base-300 pt-3"
            >
              <h3 className="text-sm font-medium">
                {PROJECT_CONTEXT_SECTION_LABELS[item.section]}
              </h3>
              <p className="whitespace-pre-wrap text-sm">{item.content}</p>
              {item.content.length > PROSE_MAX_CHARS && (
                <p className="text-sm">
                  This answer exceeds the section limit. Shorten it before
                  adding it to Context.
                </p>
              )}
              <button
                type="button"
                className="btn btn-sm"
                disabled={
                  busy ||
                  !canUse(item.section) ||
                  item.content.length > PROSE_MAX_CHARS
                }
                onClick={() => onUse(item.section, item.content)}
              >
                {canUse(item.section)
                  ? "Use in Context"
                  : "Existing context preserved"}
              </button>
            </div>
          ))}
          <p className="text-xs text-base-content/60">
            Use Save changes below to save accepted answers to the existing
            Context sections. Questionnaire text is not sent to AI by this
            import.
          </p>
        </div>
      )}
    </details>
  );
}
