import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  seed: vi.fn(),
  due: vi.fn(),
  claim: vi.fn(),
  job: vi.fn(),
  finish: vi.fn(),
  createTask: vi.fn(),
  byRequest: vi.fn(),
  inspect: vi.fn(),
  performance: vi.fn(),
}));
vi.mock("./ArticleFollowUpRepository", () => ({
  ArticleFollowUpRepository: {
    seedPublishedJobs: mocks.seed,
    due: mocks.due,
    claim: mocks.claim,
    publishedJob: mocks.job,
    finish: mocks.finish,
  },
}));
vi.mock("./ExecutionTaskRepository", () => ({
  ExecutionTaskRepository: {
    create: mocks.createTask,
    byRequest: mocks.byRequest,
  },
}));
vi.mock("@/server/features/gsc/services/GscService", () => ({
  GscService: {
    inspectUrls: mocks.inspect,
    getPerformance: mocks.performance,
  },
}));
vi.mock("@/server/lib/audit/url-policy", () => ({
  normalizeAndValidateStartUrl: async (url: string) => url,
}));

import { runScheduledArticleFollowUps } from "./ArticleFollowUpService";

const now = new Date("2026-10-07T18:00:00.000Z");
const job = {
  id: "article",
  projectId: "p1",
  publishedUrl: "https://example.com/article",
  publishedAt: "2026-08-01T18:00:00.000Z",
};
function row(stage: string) {
  return {
    id: `follow-${stage}`,
    projectId: "p1",
    jobId: job.id,
    stage,
    dueAt: "2026-10-01T18:00:00.000Z",
    baselineAt: job.publishedAt,
    scheduleBasis: "publication",
    state: "pending",
    attempts: 0,
  };
}
async function run(stage: string) {
  mocks.due.mockResolvedValue([row(stage)]);
  await runScheduledArticleFollowUps();
  return mocks.finish.mock.calls.at(-1)?.[2];
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(now);
  vi.clearAllMocks();
  mocks.claim.mockResolvedValue(true);
  mocks.job.mockResolvedValue(job);
  mocks.createTask.mockResolvedValue({ id: "task" });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("post-publication evidence handling", () => {
  it("retries a challenged page without creating a technical task", async () => {
    const websiteFetch = vi.fn().mockResolvedValue(
      new Response("Blocked", {
        status: 202,
        headers: { "sg-captcha": "challenge" },
      }),
    );
    vi.stubGlobal("fetch", websiteFetch);
    const result = await run("technical");
    expect(result).toMatchObject({ state: "pending", outcome: "unavailable" });
    expect(websiteFetch).toHaveBeenCalledWith(
      job.publishedUrl,
      expect.objectContaining({
        headers: expect.objectContaining({ "user-agent": "OpenSEO" }),
      }),
    );
    expect(mocks.createTask).not.toHaveBeenCalled();
  });

  it("creates a single agency task for a confirmed missing page", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("Missing", { status: 404 })),
    );
    const result = await run("technical");
    expect(result).toMatchObject({
      state: "complete",
      outcome: "issue",
      taskId: "task",
    });
    expect(mocks.createTask).toHaveBeenCalledOnce();
  });

  it("recognizes googlebot noindex regardless of meta attribute order", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response('<html><meta content="none" name="googlebot"></html>', {
          status: 200,
        }),
      ),
    );
    const result = await run("technical");
    expect(result).toMatchObject({
      state: "complete",
      outcome: "issue",
      taskId: "task",
    });
  });

  it("records missing Search Console rows as no data, with no task", async () => {
    mocks.performance.mockResolvedValue({ rows: [] });
    const result = await run("metrics_14");
    expect(result).toMatchObject({ state: "complete", outcome: "no_data" });
    expect(mocks.createTask).not.toHaveBeenCalled();
  });

  it("records a positive index inspection without submitting the URL", async () => {
    mocks.inspect.mockResolvedValue({
      results: [
        {
          result: {
            indexStatusResult: { verdict: "PASS", coverageState: "Indexed" },
          },
        },
      ],
    });
    const result = await run("indexing_3");
    expect(result).toMatchObject({ state: "complete", outcome: "indexed" });
    expect(mocks.createTask).not.toHaveBeenCalled();
  });

  it("compares two 28-day windows at reassessment", async () => {
    mocks.performance
      .mockResolvedValueOnce({ rows: [{ clicks: 20, impressions: 200 }] })
      .mockResolvedValueOnce({ rows: [{ clicks: 10, impressions: 100 }] });
    const result = await run("reassess_60");
    expect(result.detail).toContain(
      "Prior 28 days: 10 clicks, 100 impressions",
    );
    const first = mocks.performance.mock.calls[0][0];
    const second = mocks.performance.mock.calls[1][0];
    expect(first.endDate).toBe("2026-10-04");
    expect(second.endDate).toBe("2026-09-06");
    expect(mocks.createTask).not.toHaveBeenCalled();
  });
});
