import { z } from "zod";
import { createServerFn } from "@tanstack/react-start";
import { requireProjectContext } from "@/serverFunctions/middleware";
import { requireOrgPermission } from "@/server/auth/org-gate";
import { isHostedServerAuthMode } from "@/server/lib/runtime-env";
import { AppError } from "@/server/lib/errors";
import {
  getWorkPlan,
  acceptWorkRecommendation,
} from "@/server/features/automation/WorkPlanningService";
import {
  seedInventory,
  refreshInventoryBatch,
} from "@/server/features/automation/InventoryService";
const request = z.object({ projectId: z.string().min(1) });
async function authorize(context: { role: string }) {
  requireOrgPermission(context, { integration: ["manage"] });
  if (await isHostedServerAuthMode()) throw new AppError("FORBIDDEN");
}
export const getMonthlyWorkPlan = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(request)
  .handler(async ({ context }) => {
    await authorize(context);
    return getWorkPlan(context.projectId);
  });
export const discoverInventory = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(request)
  .handler(async ({ context }) => {
    await authorize(context);
    return seedInventory(context.projectId);
  });
export const refreshInventory = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(request)
  .handler(async ({ context }) => {
    await authorize(context);
    return refreshInventoryBatch(context.projectId);
  });
export const acceptPlanItem = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(
    request.extend({
      id: z.string().regex(/^[a-f0-9]{64}$/),
      fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
      month: z.string().regex(/^\d{4}-\d{2}$/),
    }),
  )
  .handler(async ({ context, data }) => {
    await authorize(context);
    return acceptWorkRecommendation(context.projectId, context.userId, data);
  });
