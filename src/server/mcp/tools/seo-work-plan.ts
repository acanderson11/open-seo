import { z } from "zod";
import { getAgentWorkPlan } from "@/server/features/automation/WorkPlanAgentService";
import { withMcpProjectAuth } from "@/server/mcp/project-auth";
import { buildProjectMeta } from "@/server/mcp/context";
import { mcpResponse } from "@/server/mcp/formatters";
import { projectIdSchema } from "@/server/mcp/schemas";
import {
  looseObjectOutputSchema,
  optionalMetaOutputSchema,
} from "@/server/mcp/output-schemas";
import { requireOrgPermission } from "@/server/auth/org-gate";
import { isHostedServerAuthMode } from "@/server/lib/runtime-env";
import { AppError } from "@/server/lib/errors";
const inputSchema = {
  projectId: projectIdSchema,
  pageOffset: z.number().int().min(0).max(499).default(0),
};
export const getSeoWorkPlanTool = {
  name: "get_seo_work_plan",
  config: {
    title: "Read SEO work plan and inventory",
    description:
      "Read this project's execution work plan, page inventory, scan failures, dated GSC/GA4 evidence, active tasks and feedback-derived writing guidelines. Start here for SEO strategy or content briefs. Returns 20 page excerpts per call; use nextPageOffset for more. Reuses existing evidence, performs no paid SEO research, and does not mutate or execute work. Agency self-host administrators only.",
    inputSchema,
    outputSchema: {
      evidence: looseObjectOutputSchema,
      ...optionalMetaOutputSchema,
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: true,
    },
  },
  handler: withMcpProjectAuth(
    async (args: z.infer<z.ZodObject<typeof inputSchema>>, context) => {
      requireOrgPermission(context.auth, { integration: ["manage"] });
      if (await isHostedServerAuthMode()) throw new AppError("FORBIDDEN");
      const evidence = await getAgentWorkPlan(args.projectId, args.pageOffset);
      return mcpResponse({
        text: "Provisional SEO work plan with dated evidence and coverage limitations. Validate search intent and commercial fit; do not interpret unreadable pages as defects or verified content gaps.",
        meta: buildProjectMeta(
          context,
          args.projectId,
          `/p/${args.projectId}/execution?executionView=plan`,
        ),
        structuredContent: { evidence },
      });
    },
  ),
};
