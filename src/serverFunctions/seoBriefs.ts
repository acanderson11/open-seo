import { draftSavedBrief } from "@/server/features/automation/BriefDraftService";
import { z } from "zod";
import { createServerFn } from "@tanstack/react-start";
import { requireProjectContext } from "@/serverFunctions/middleware";
import { requireOrgPermission } from "@/server/auth/org-gate";
import { isHostedServerAuthMode } from "@/server/lib/runtime-env";
import { AppError } from "@/server/lib/errors";
import { buildBillingCustomer } from "@/server/mcp/context";
import { BriefRepository } from "@/server/features/automation/BriefRepository";
import {
  investigateBrief,
  getSavedBrief,
} from "@/server/features/automation/BriefService";
import { briefRequest } from "@/types/schemas/seoBrief";
const projectRequest = z.object({ projectId: z.string().min(1) });
async function authorize(context: { role: string }) {
  requireOrgPermission(context, { integration: ["manage"] });
  if (await isHostedServerAuthMode()) throw new AppError("FORBIDDEN");
}
export const createSeoBrief = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(briefRequest)
  .handler(async ({ context, data }) => {
    await authorize(context);
    return investigateBrief(
      context.projectId,
      context.userId,
      data,
      buildBillingCustomer(context, context.projectId),
    );
  });
export const listSeoBriefs = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(projectRequest)
  .handler(async ({ context }) => {
    await authorize(context);
    return BriefRepository.list(context.projectId);
  });
export const readSeoBrief = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(projectRequest.extend({ id: z.string().uuid() }))
  .handler(async ({ context, data }) => {
    await authorize(context);
    return getSavedBrief(context.projectId, data.id);
  });

export const createBriefDraft = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(projectRequest.extend({ id: z.string().uuid() }))
  .handler(async ({ context, data }) => {
    await authorize(context);
    if (!context.project.domain) throw new AppError("VALIDATION_ERROR");
    return draftSavedBrief(
      context.projectId,
      context.project.domain,
      context.userId,
      data.id,
    );
  });
