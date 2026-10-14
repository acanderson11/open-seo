import { z } from "zod";
import { makeToolContext } from "@/server/mcp/tools/tool-test-support";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Tool } from "ai";
import { buildSamMcpTools, waitingAuditStatusTool } from "./samChatTools";

vi.mock("cloudflare:workers", () => ({
  env: {},
  DurableObject: class {
    kind = "mock";
  },
}));

// The server-side wait in SAM's get_audit_status: a completed audit must
// return without waiting, and a running one must return as soon as the status
// line changes — a regression in either turns every status check into the
// full 50-second budget.

const running = (line: string) => ({
  summary: line,
  data: { status: { status: "running" } },
});
const completed = {
  summary: "done",
  data: { status: { status: "completed" } },
};

function buildTool(outputs: unknown[]) {
  const execute = vi.fn(() => Promise.resolve(outputs.shift()));
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the wrapper only touches execute
  const tool = waitingAuditStatusTool(() => ({ execute }) as unknown as Tool);
  return { tool, execute };
}

const callOptions = { toolCallId: "t", messages: [] };

afterEach(() => {
  vi.useRealTimers();
});

describe("waitingAuditStatusTool", () => {
  it("returns a finished audit without waiting", async () => {
    const { tool, execute } = buildTool([completed]);
    await expect(tool.execute?.({}, callOptions)).resolves.toBe(completed);
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("waits while running and returns as soon as progress changes", async () => {
    vi.useFakeTimers();
    const { tool, execute } = buildTool([
      running("phase crawl, 3/56 pages"),
      running("phase crawl, 3/56 pages"),
      running("phase lighthouse, 56/56 pages"),
    ]);
    const call: unknown = tool.execute?.({}, callOptions);
    await vi.advanceTimersByTimeAsync(10_000);
    await expect(call).resolves.toMatchObject({
      summary: "phase lighthouse, 56/56 pages",
    });
    expect(execute).toHaveBeenCalledTimes(3);
  });
});

const planHandler = vi.hoisted(() =>
  vi.fn(async () => ({ content: [{ type: "text", text: "Scoped evidence" }] })),
);
vi.mock("@/server/mcp/tools/seo-work-plan", () => ({
  getSeoWorkPlanTool: {
    name: "get_seo_work_plan",
    config: {
      description: "Test",
      inputSchema: { projectId: z.string(), pageOffset: z.number().default(0) },
    },
    handler: planHandler,
  },
}));
it("binds SAM work-plan reads to its session project even if the model supplies a foreign ID", async () => {
  const tools = buildSamMcpTools(makeToolContext().auth, {
    id: "session-project",
    domain: "example.com",
  });
  await tools.get_seo_work_plan.execute?.(
    { projectId: "foreign-project", pageOffset: 20 },
    callOptions,
  );
  expect(planHandler).toHaveBeenCalledWith(
    { projectId: "session-project", pageOffset: 20 },
    expect.anything(),
  );
});
