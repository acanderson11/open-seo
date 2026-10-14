import { reviseArticle } from "@/server/features/automation/ArticleRevisionService";
import {
  WorkflowEntrypoint,
  type WorkflowEvent,
  type WorkflowStep,
} from "cloudflare:workers";
import { pgStep } from "./pgStep";
import { AutopilotRepository as auto } from "@/server/features/automation/AutopilotRepository";
import {
  collectPlanningInput,
  selectOpportunity,
  producePlannedDraft,
  notifyPlannedDraft,
} from "@/server/features/automation/AutopilotService";
const once = {
  retries: { limit: 0, delay: "1 second" as const },
  timeout: "3 minutes" as const,
};
export class ContentAutopilotWorkflow extends WorkflowEntrypoint<
  Env,
  {
    runId: string;
    projectId: string;
    revisionJobId?: string;
    revisionVersion?: number;
  }
> {
  async run(
    event: WorkflowEvent<{
      runId: string;
      projectId: string;
      revisionJobId?: string;
      revisionVersion?: number;
    }>,
    step: WorkflowStep,
  ) {
    const { runId, projectId } = event.payload;
    const claimed = await pgStep(step, "Claim project planning run", once, () =>
      auto.claimRun(runId),
    );
    if (!claimed) return;
    try {
      if (event.payload.revisionJobId && event.payload.revisionVersion) {
        const job = await pgStep(
          step,
          "Revise article from reviewer feedback",
          once,
          () =>
            reviseArticle(
              projectId,
              event.payload.revisionJobId!,
              event.payload.revisionVersion!,
            ),
        );
        await pgStep(step, "Deliver revised article", once, () =>
          notifyPlannedDraft(job),
        );
        await pgStep(step, "Finish revision run", once, () =>
          auto.finishRun(
            runId,
            job?.state ?? "held",
            "Revision processing complete.",
          ),
        );
        return;
      }
      const input = await pgStep(
        step,
        "Read native Context and site opportunities",
        once,
        () => collectPlanningInput(projectId),
      );
      const choice = await pgStep(
        step,
        "Select evidence based article",
        once,
        () => selectOpportunity(input),
      );
      const job = await pgStep(
        step,
        "Produce and persist reviewed article",
        once,
        () => producePlannedDraft(runId, input, choice),
      );
      await pgStep(step, "Deliver approval request", once, () =>
        notifyPlannedDraft(job),
      );
    } catch (error) {
      console.error("autopilot.workflow failed:", error, { runId, projectId });
      await pgStep(step, "Record planning interruption", once, async () => {
        await auto.finishRun(
          runId,
          "failed",
          "Planning or delivery stopped. Check data connections and the execution board; no paid step is blindly retried.",
        );
        await auto.status(
          projectId,
          "Automatic run needs attention: check data connections, draft quality, and review delivery.",
        );
      });
    }
  }
}
