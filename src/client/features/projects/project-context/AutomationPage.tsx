import { AutopilotSettings } from "./AutopilotSettings";
import { ProjectImageSettings } from "./ProjectImageSettings";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getStandardErrorMessage } from "@/client/lib/error-messages";
import { Link } from "@tanstack/react-router";
import { getAutomationSettings } from "@/serverFunctions/automation";
export function AutomationSettingsPage({ projectId }: { projectId: string }) {
  const client = useQueryClient(),
    key = ["automation-settings", projectId];
  const query = useQuery({
    queryKey: key,
    queryFn: () => getAutomationSettings({ data: { projectId } }),
  });
  const refresh = async () => {
    await Promise.all([
      client.invalidateQueries({ queryKey: key }),
      client.invalidateQueries({ queryKey: ["automation", projectId] }),
    ]);
  };
  if (query.isPending) return <p role="status">Loading execution settings…</p>;
  if (query.isError)
    return (
      <p role="alert">
        {getStandardErrorMessage(query.error, "Could not load settings.")}
      </p>
    );
  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-xl font-semibold">Execution settings</h2>
        <p className="text-sm text-base-content/60">
          Control content automation and approval for this project. Approved
          articles are ready for manual copy/paste or optional WordPress
          publishing.
        </p>
      </div>
      <AutopilotSettings
        key={query.data.policy?.version ?? "new"}
        projectId={projectId}
        data={query.data}
        onSaved={refresh}
      />
      <ProjectImageSettings projectId={projectId} onSaved={refresh} />
      <Link
        className="btn btn-outline btn-sm"
        to="/p/$projectId/execution"
        params={{ projectId }}
      >
        Open execution board
      </Link>
    </div>
  );
}
