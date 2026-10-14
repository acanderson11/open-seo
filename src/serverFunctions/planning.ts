import { createServerFn } from "@tanstack/react-start";
import { requireProjectContext } from "@/serverFunctions/middleware";
import { requireOrgPermission } from "@/server/auth/org-gate";
import { isHostedServerAuthMode } from "@/server/lib/runtime-env";
import { AppError } from "@/server/lib/errors";
import { projectRequest } from "@/types/schemas/automation";
import { getPlanningPreview } from "@/server/features/automation/PlanningService";
export const getExecutionPlan = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(projectRequest)
  .handler(async ({ context }) => {
    requireOrgPermission(context, { integration: ["manage"] });
    if (await isHostedServerAuthMode()) throw new AppError("FORBIDDEN");
    return getPlanningPreview(context.projectId);
  });
