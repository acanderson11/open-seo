import { createFileRoute } from "@tanstack/react-router";
import { AgencyProfilePage } from "@/client/features/projects/project-context/AgencyProfilePage";
export const Route = createFileRoute("/_project/p/$projectId/settings/profile")(
  { component: ProfileRoute },
);
function ProfileRoute() {
  const { projectId } = Route.useParams();
  return <AgencyProfilePage projectId={projectId} />;
}
