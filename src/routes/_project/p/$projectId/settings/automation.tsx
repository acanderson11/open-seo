import { createFileRoute } from "@tanstack/react-router";
import { AutomationSettingsPage } from "@/client/features/projects/project-context/AutomationPage";
export const Route = createFileRoute(
  "/_project/p/$projectId/settings/automation",
)({ component: Page });
function Page() {
  const { projectId } = Route.useParams();
  return <AutomationSettingsPage key={projectId} projectId={projectId} />;
}
