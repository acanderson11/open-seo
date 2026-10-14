import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { getProjectContext } from "@/serverFunctions/projectContext";
import { saveAgencyProfile } from "@/serverFunctions/agencyProfile";
import { getStandardErrorMessage } from "@/client/lib/error-messages";
import {
  US_TIMEZONES,
  readAgencyProfile,
  type AgencyField,
} from "@/types/schemas/agencyProfile";
import { projectContextQueryKey, type ProjectContextData } from "./shared";

export function AgencyProfilePage({ projectId }: { projectId: string }) {
  const query = useQuery({
    queryKey: projectContextQueryKey(projectId),
    queryFn: () => getProjectContext({ data: { projectId } }),
    staleTime: 0,
  });
  if (query.isPending) return <p role="status">Loading business profile…</p>;
  if (query.isError)
    return (
      <p role="alert" className="alert alert-error">
        {getStandardErrorMessage(query.error, "Could not load this profile.")}
      </p>
    );
  return (
    <AgencyProfileForm
      key={projectId}
      projectId={projectId}
      context={query.data}
    />
  );
}
function AgencyProfileForm({
  projectId,
  context,
}: {
  projectId: string;
  context: ProjectContextData;
}) {
  const queryClient = useQueryClient(),
    queryKey = projectContextQueryKey(projectId);
  const stored = readAgencyProfile(context.customSections);
  const [drafts, setDrafts] = useState<Partial<Record<AgencyField, string>>>(
    {},
  );
  const value = (key: AgencyField) => drafts[key] ?? stored[key] ?? "";
  const changed: Partial<Record<AgencyField, string>> = {};
  const keys: AgencyField[] = ["timezone"];
  for (const key of keys) {
    const draft = drafts[key];
    if (draft !== undefined && draft.trim() !== (stored[key] ?? ""))
      changed[key] = draft;
  }
  const mutation = useMutation({
    mutationFn: (fields: Partial<Record<AgencyField, string>>) =>
      saveAgencyProfile({ data: { projectId, fields } }),
    onMutate: () => queryClient.cancelQueries({ queryKey }),
    onSuccess: (saved) => {
      queryClient.setQueryData(queryKey, saved);
      setDrafts({});
      toast.success("Reporting preference saved");
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey }),
  });
  function submit(event: FormEvent) {
    event.preventDefault();
    if (!mutation.isPending && Object.keys(changed).length)
      mutation.mutate(changed);
  }
  return (
    <section className="space-y-6">
      <div className="space-y-2">
        <h2 className="text-xl font-semibold">Reporting</h2>
        <p className="text-sm text-base-content/70">
          Choose the time zone for agency reports. Manage business information
          and writing preferences in Context.
        </p>
      </div>
      <form onSubmit={submit} className="space-y-5">
        <fieldset disabled={mutation.isPending} className="space-y-5">
          <div className="space-y-1.5">
            <label
              htmlFor="agency-timezone"
              className="block text-sm font-medium"
            >
              Reporting time zone
            </label>
            <select
              id="agency-timezone"
              className="select select-bordered w-full"
              value={value("timezone")}
              onChange={(event) =>
                setDrafts((current) => ({
                  ...current,
                  timezone: event.target.value,
                }))
              }
            >
              <option value="" disabled>
                Choose a US time zone
              </option>
              {US_TIMEZONES.map(([zone, label]) => (
                <option key={zone} value={zone}>
                  {label}
                </option>
              ))}
            </select>
            <p className="text-xs text-base-content/60">
              Saved as your reporting preference. Source reports retain their
              original time zones.
            </p>
          </div>
        </fieldset>
        {mutation.isError && (
          <p role="alert" className="alert alert-error">
            {getStandardErrorMessage(
              mutation.error,
              "Could not save this preference. Your edits are still here.",
            )}
          </p>
        )}
        <button
          type="submit"
          className="btn btn-primary"
          disabled={mutation.isPending || !Object.keys(changed).length}
        >
          {mutation.isPending ? "Saving…" : "Save preference"}
        </button>
        <p className="text-xs text-base-content/60">
          This preference does not launch work or publish content.
        </p>
      </form>
    </section>
  );
}
