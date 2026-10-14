import type * as RepoModule from "./AutomationRepository";
import type { Client } from "@libsql/client";
import {
  beforeAll,
  afterAll,
  beforeEach,
  describe,
  it,
  expect,
  vi,
} from "vitest";
import { agencyJob as job, openAgencyTestDb } from "./agency-test-schema";
vi.mock("cloudflare:workers", () => ({ env: { DATABASE_PROVIDER: "d1" } }));
let client: Client;
let repo: typeof RepoModule.AutomationRepository;
beforeAll(async () => {
  const test = await openAgencyTestDb();
  client = test.client;
  vi.doMock("@/db", () => ({ db: test.db }));
  vi.doMock("@/db/runBatch", () => ({ runBatch: test.runBatch }));
  repo = (await import("./AutomationRepository")).AutomationRepository;
});
afterAll(() => client.close());
beforeEach(async () => {
  await client.executeMultiple(
    "DELETE FROM automation_approvals; DELETE FROM automation_jobs; DELETE FROM automation_policies;",
  );
});
describe("durable automation queue", () => {
  it("deduplicates project requests and isolates project reads", async () => {
    expect(await repo.create(job("j1"))).toBe(true);
    expect(await repo.create(job("j2"))).toBe(false);
    expect(await repo.job("p2", "j1")).toBeNull();
    expect(await repo.create(job("j3", "p2"))).toBe(true);
  });
  it("serializes reservations and enforces the monthly allowance", async () => {
    await repo.savePolicy("p1", {
      enabled: true,
      monthlyLimit: 1,
      approval: "agency",
      expectedVersion: null,
    });
    const p = await repo.policy("p1");
    const claims = await Promise.all([
      repo.reserve("p1", "j1", p.version, "2026-09"),
      repo.reserve("p1", "j2", p.version, "2026-09"),
    ]);
    expect(claims.filter(Boolean)).toHaveLength(1);
    const busy = (await repo.policy("p1")).busyJobId!;
    await repo.releaseSlot("p1", "not-the-owner");
    expect((await repo.policy("p1")).busyJobId).toBe(busy);
    await repo.releaseSlot("p1", busy);
    expect(await repo.reserve("p1", "j3", p.version, "2026-09")).toBe(false);
    expect(await repo.reserve("p1", "j3", p.version, "2026-10")).toBe(true);
  });
  it("rejects stale settings and pauses without resetting usage", async () => {
    expect(
      await repo.savePolicy("p1", {
        enabled: true,
        monthlyLimit: 4,
        approval: "agency",
        expectedVersion: null,
      }),
    ).toBe(true);
    const p = await repo.policy("p1");
    await repo.reserve("p1", "j1", p.version, "2026-09");
    await repo.releaseSlot("p1", "j1");
    expect(
      await repo.savePolicy("p1", {
        enabled: false,
        monthlyLimit: 4,
        approval: "agency",
        expectedVersion: p.version,
      }),
    ).toBe(true);
    expect(
      await repo.savePolicy("p1", {
        enabled: true,
        monthlyLimit: 4,
        approval: "none",
        expectedVersion: p.version,
      }),
    ).toBe(false);
    const paused = await repo.policy("p1");
    expect(paused.used).toBe(1);
    expect(await repo.reserve("p1", "j2", paused.version, "2026-09")).toBe(
      false,
    );
  });
  it("keeps the first version-bound agency decision and rejects cross-project approval", async () => {
    await repo.create({ ...job("j1"), state: "awaiting_approval" });
    expect(await repo.approve("p1", "j1", "a1", "changes_requested")).toBe(
      true,
    );
    expect(await repo.approve("p1", "j1", "a2", "approved")).toBe(false);
    await repo.create({ ...job("j4"), requestKey: "request-4" });
    expect(await repo.approve("p2", "j4", "a2", "approved")).toBe(false);
  });
});
it("rolls back the approval if the state transition fails", async () => {
  await repo.create({ ...job("atomic"), state: "awaiting_approval" });
  await client.executeMultiple(
    "CREATE TRIGGER fail_approval_state BEFORE UPDATE ON automation_jobs WHEN NEW.state = 'ready_for_manual_publication' BEGIN SELECT RAISE(ABORT, 'synthetic failure'); END;",
  );
  try {
    await expect(
      repo.approve(
        "p1",
        "atomic",
        "actor",
        "approved",
        "ready_for_manual_publication",
      ),
    ).rejects.toThrow();
    expect(
      (
        await client.execute(
          "SELECT COUNT(*) AS count FROM automation_approvals",
        )
      ).rows[0]?.count,
    ).toBe(0);
    expect((await repo.job("p1", "atomic"))?.state).toBe("awaiting_approval");
  } finally {
    await client.execute("DROP TRIGGER fail_approval_state");
  }
});
it("deduplicates daily planner reservations and consumes each run once", async () => {
  const auto = (await import("./AutopilotRepository")).AutopilotRepository;
  const attempts = await Promise.all([
    auto.reserveRun("p1", "2026-09-01"),
    auto.reserveRun("p1", "2026-09-01"),
  ]);
  expect(attempts.filter(Boolean)).toHaveLength(1);
  const run = attempts.find(Boolean)!;
  expect(await auto.claimRun(run.id)).toBe(true);
  expect(await auto.claimRun(run.id)).toBe(false);
  expect(await auto.reserveRun("p2", "2026-09-01")).not.toBeNull();
});
describe("review feedback and learning", () => {
  const feedback = {
    message: "Use direct explanations instead of metaphors.",
    scope: "preference" as const,
    category: "voice" as const,
    instruction: "Use direct explanations. Avoid metaphors.",
  };
  it("archives the reviewed version and activates an explicit preference atomically", async () => {
    await repo.create({
      ...job("learn"),
      state: "awaiting_approval",
      bodyHtml: "<p>Before</p>",
    });
    expect(
      await repo.approve("p1", "learn", "agency", "changes_requested", {
        state: "revision_queued",
        artifactVersion: 1,
        feedback,
      }),
    ).toBe(true);
    const learning = (await import("./ContentLearningRepository"))
      .ContentLearningRepository;
    expect((await learning.active("p1"))[0]?.instruction).toBe(
      feedback.instruction,
    );
    expect(await learning.active("p2")).toEqual([]);
    const history = await learning.history("p1", "learn");
    expect(history.feedback[0]?.artifactVersion).toBe(1);
    expect(history.revisions[0]?.bodyHtml).toBe("<p>Before</p>");
    expect(
      await repo.approve("p1", "learn", "agency", "approved", {
        state: "ready_for_manual_publication",
        artifactVersion: 1,
      }),
    ).toBe(false);
    expect(await learning.claim("p1", "learn", 1)).toBe(true);
    expect(await learning.claim("p1", "learn", 1)).toBe(false);
    expect((await repo.job("p1", "learn"))?.version).toBe(1);
    expect((await repo.job("p1", "learn"))?.qualityPassed).toBe(0);
  });
  it("does not generalize article-only edits and holds overlapping preferences", async () => {
    const learning = (await import("./ContentLearningRepository"))
      .ContentLearningRepository;
    for (const [id, scope] of [
      ["one", "article"],
      ["two", "preference"],
      ["three", "preference"],
      ["four", "fact"],
    ] as const) {
      await repo.create({
        ...job(id),
        requestKey: id,
        state: "awaiting_approval",
      });
      await repo.approve("p1", id, "actor", "changes_requested", {
        state: "revision_queued",
        artifactVersion: 1,
        feedback: { ...feedback, scope },
      });
    }
    const rules = await learning.guidelines("p1");
    expect(rules).toHaveLength(3);
    expect(rules.filter((item) => item.rule.status === "active")).toHaveLength(
      1,
    );
    expect(
      rules.filter((item) => item.rule.status === "proposed"),
    ).toHaveLength(2);
  });
  it("rejects stale versions without saving feedback or learning", async () => {
    await repo.create({
      ...job("stale"),
      version: 2,
      state: "awaiting_approval",
    });
    expect(
      await repo.approve("p1", "stale", "actor", "changes_requested", {
        state: "revision_queued",
        artifactVersion: 1,
        feedback,
      }),
    ).toBe(false);
    const learning = (await import("./ContentLearningRepository"))
      .ContentLearningRepository;
    expect((await learning.history("p1", "stale")).feedback).toEqual([]);
    expect(await learning.active("p1")).toEqual([]);
  });
  it("keeps only one competing decision and preserves reversible guideline provenance", async () => {
    const learning = (await import("./ContentLearningRepository"))
      .ContentLearningRepository;
    await repo.create({ ...job("race"), state: "awaiting_approval" });
    const decisions = [
      await repo.approve("p1", "race", "actor", "changes_requested", {
        state: "revision_queued",
        artifactVersion: 1,
        feedback,
      }),
      await repo.approve("p1", "race", "actor", "approved", {
        state: "ready_for_manual_publication",
        artifactVersion: 1,
      }),
    ];
    expect(decisions.filter(Boolean)).toHaveLength(1);
    expect(
      await repo.approve("p1", "race", "actor", "approved", {
        state: "ready_for_manual_publication",
        artifactVersion: 1,
      }),
    ).toBe(false);
    const rules = await learning.active("p1");
    if (!rules.length) return;
    const rule = rules[0];
    expect(
      await learning.setStatus("p2", rule.id, 1, "disabled", "actor"),
    ).toBe(false);
    expect(
      await learning.setStatus("p1", rule.id, 1, "disabled", "actor"),
    ).toBe(true);
    expect(await learning.setStatus("p1", rule.id, 1, "active", "actor")).toBe(
      false,
    );
    expect(await learning.active("p1")).toEqual([]);
    expect((await learning.guidelines("p1"))[0]?.feedback.message).toBe(
      feedback.message,
    );
    expect(await learning.setStatus("p1", rule.id, 2, "active", "actor")).toBe(
      true,
    );
  });
});
it("persists passage-only feedback on the reviewed version, isolates it, and rejects duplicate writes", async () => {
  await repo.create({
    ...job("passages"),
    state: "needs_revision",
    bodyHtml: "<h2>Start</h2><p>Before</p>",
  });
  const input = {
    state: "revision_queued",
    artifactVersion: 1,
    feedback: {
      message: "",
      scope: "article" as const,
      category: "voice" as const,
      instruction: "",
      passages: [
        { blockIndex: 1, quote: "Before", message: "Use a concrete example." },
      ],
    },
  };
  expect(
    await repo.approve("p2", "passages", "actor", "changes_requested", input),
  ).toBe(false);
  expect(
    await repo.approve("p1", "passages", "actor", "changes_requested", input),
  ).toBe(true);
  expect(
    await repo.approve("p1", "passages", "actor", "changes_requested", input),
  ).toBe(false);
  const learning = (await import("./ContentLearningRepository"))
    .ContentLearningRepository;
  const history = await learning.history("p1", "passages");
  expect(history.feedback).toHaveLength(1);
  expect(history.feedback[0]?.passages).toMatchObject(input.feedback.passages);
  expect(history.feedback[0]?.artifactVersion).toBe(1);
  expect(history.revisions[0]?.bodyHtml).toContain("Before");
  expect((await learning.history("p2", "passages")).feedback).toEqual([]);
  expect(await learning.active("p1")).toEqual([]);
  expect((await repo.job("p1", "passages"))?.state).toBe("revision_queued");
});
