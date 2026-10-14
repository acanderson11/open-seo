import { createServerFn } from "@tanstack/react-start";
import { requireProjectContext } from "@/serverFunctions/middleware";
import { requireOrgPermission } from "@/server/auth/org-gate";
import { isHostedServerAuthMode } from "@/server/lib/runtime-env";
import { AppError } from "@/server/lib/errors";
import { wordpressSetup } from "@/types/schemas/autopilot";
import { connectWordpress } from "@/server/features/automation/WordpressPublication";
import { WordpressConnectionError } from "@/server/features/automation/WordpressConnectionResponse";
export const connectAutomationWordpress = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(wordpressSetup)
  .handler(async ({ context, data }) => {
    requireOrgPermission(context, { integration: ["manage"] });
    if (await isHostedServerAuthMode()) throw new AppError("FORBIDDEN");
    if (!context.project.domain) throw new AppError("VALIDATION_ERROR");
    try {
      await connectWordpress(context.projectId, context.project.domain, data);
    } catch (error) {
      if (error instanceof WordpressConnectionError)
        return { connected: false as const, reason: error.reason };
      throw error;
    }
    return { connected: true as const };
  });
