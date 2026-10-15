import type { ArticleBrief } from "@/types/schemas/automation";

/**
 * Everything the model sees for one article version: Context, sources, the
 * opportunity, and for revisions the previous draft with reviewer comments.
 */
export type GenerationJob = {
  contextVersion: string;
  policyVersion: string;
  context: string;
  opportunity: {
    id: string;
    kind: string;
    topic: string;
    intent: string;
    rationale: string;
    targetUrl: string | null;
  };
  sources: { id: string; url: string; text: string }[];
  savedBrief?: ArticleBrief;
  revision?: {
    version: number;
    previousTitle: string;
    previousBodyHtml: string;
    comments: { message: string; instruction: string; scope: string }[];
  };
};

/** Saved-brief inputs for a draft, as BriefDraftService and autopilot supply them. */
export type PlannedDraft = {
  rationale: string;
  sourceUrls: string[];
  kind?: "new_content" | "refresh_content";
  savedBrief?: {
    brief: ArticleBrief;
    sources: { id: string; url: string; text: string }[];
    contextVersion: string;
    guidance: string;
  };
};

/** Starts one article version on the in-app engine; the Workflow instance id is derived from it. */
export type GenerationRequest = {
  projectId: string;
  jobId: string;
  /** The version this run produces: 1 for a new draft, n + 1 for a revision of n. */
  version: number;
  /** Set by startGeneration so a version that runs again gets its own Workflow instance. */
  runId?: string;
  /** Draft runs only. */
  domain?: string;
  topic?: string;
  targetUrl?: string;
  planned?: PlannedDraft;
};
