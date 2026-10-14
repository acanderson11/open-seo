import type { getAutomationDraft } from "@/serverFunctions/automation";
type Brief = NonNullable<
  Awaited<ReturnType<typeof getAutomationDraft>>
>["researchBrief"];
export function ArticleResearchGaps({ brief }: { brief: Brief }) {
  if (!brief || brief.action !== "research_first") return null;
  const gaps = brief.sections.filter((s) => s.kind === "gap");
  const questions = brief.sections.filter((s) => s.kind === "expert_question");
  return (
    <details
      className="rounded border border-base-300 p-4 space-y-3"
      aria-label="Research gaps"
    >
      <summary className="cursor-pointer font-semibold">
        Optional research & questions
      </summary>
      <p className="text-sm">
        From the saved brief: {brief.title ?? brief.topic}. These are the
        investigation’s recorded limitations. Answers can strengthen the
        article, but are not required for revision or approval.
      </p>
      {gaps.length ? (
        <ul className="list-disc space-y-2 pl-5 text-sm">
          {gaps.map((g) => (
            <li key={g.id}>{g.detail}</li>
          ))}
        </ul>
      ) : (
        <p className="text-sm">
          This brief is marked research-first, but has no specific gap entries.
          You can continue with the available information.
        </p>
      )}
      {!!questions.length && (
        <details>
          <summary className="cursor-pointer font-medium text-sm">
            Questions you can help answer ({questions.length})
          </summary>
          <ul className="list-disc space-y-2 pl-5 mt-2 text-sm">
            {questions.map((q) => (
              <li key={q.id}>{q.detail}</li>
            ))}
          </ul>
        </details>
      )}
      <p className="text-sm">
        Add answers, examples, or source URLs if you have them. Otherwise,
        continue without them. The writer should omit unsupported claims and
        statistics rather than invent missing information.
      </p>
    </details>
  );
}
