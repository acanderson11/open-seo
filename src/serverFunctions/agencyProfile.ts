import { z } from "zod";
import { requireOrgPermission } from "@/server/auth/org-gate";
import { isHostedServerAuthMode } from "@/server/lib/runtime-env";
import { AppError } from "@/server/lib/errors";
import { previewCustomers } from "@/server/features/project-context/services/AgencyCustomersService";
import { createServerFn } from "@tanstack/react-start";
import { requireProjectContext } from "@/serverFunctions/middleware";
import { ProjectContextService } from "@/server/features/project-context/services/ProjectContextService";
import {
  agencyProfilePatchSchema,
  agencyProfileUpdates,
} from "@/types/schemas/agencyProfile";
// Reuse the existing service/repository and atomic D1/PG batch. These exact
// sections are rendered to SAM and MCP; no synchronization database is needed.
export const saveAgencyProfile = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(agencyProfilePatchSchema)
  .handler(async ({ data, context }) =>
    ProjectContextService.applyContextUpdates(
      context.projectId,
      agencyProfileUpdates(data.fields),
      "user",
    ),
  );

const sourceRequest = z.object({ projectId: z.string().min(1) });
async function requireAgencyMode(context: { role: string }) {
  requireOrgPermission(context, { integration: ["manage"] });
  // This fixed agency connection belongs to the selfhost workspace, never to
  // arbitrary organizations in OpenSEO's hosted product.
  if (await isHostedServerAuthMode()) throw new AppError("FORBIDDEN");
}
export const previewAgencyQuestionnaires = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(sourceRequest)
  .handler(async ({ context }) => {
    await requireAgencyMode(context);
    if (!context.project.domain) throw new AppError("VALIDATION_ERROR");
    return previewCustomers(context.project.domain);
  });
