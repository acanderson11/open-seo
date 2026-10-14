import type * as AutomationModule from "./AutomationRepository";
import type * as AutopilotModule from "./AutopilotRepository";
import type { Client } from "@libsql/client";
import { beforeAll, afterAll, beforeEach, it, expect, vi } from "vitest";
import { agencyJob, openAgencyTestDb } from "./agency-test-schema";

vi.mock("cloudflare:workers", () => ({ env: { DATABASE_PROVIDER: "d1" } }));
let client: Client;
let jobs: typeof AutomationModule.AutomationRepository;
let auto: typeof AutopilotModule.AutopilotRepository;
beforeAll(async () => {
  const test = await openAgencyTestDb();
  client = test.client;
  vi.doMock("@/db", () => ({ db: test.db }));
  vi.doMock("@/db/runBatch", () => ({ runBatch: test.runBatch }));
  jobs = (await import("./AutomationRepository")).AutomationRepository;
  auto = (await import("./AutopilotRepository")).AutopilotRepository;
});
afterAll(() => client.close());
beforeEach(async () => {
  await client.executeMultiple(
    "DELETE FROM automation_jobs; DELETE FROM automation_policies;",
  );
});

const savePolicy = (enabled: boolean, expectedVersion: string | null) =>
  jobs.savePolicy("p1", {
    enabled,
    delivery: "wordpress",
    monthlyLimit: 4,
    approval: "agency",
    expectedVersion,
  });

it("claims only articles approved for WordPress, once, in their own project", async () => {
  await savePolicy(true, null);
  await jobs.create({
    ...agencyJob("manual"),
    state: "ready_for_manual_publication",
  });
  await jobs.create({
    ...agencyJob("queued"),
    requestKey: "queued",
    state: "ready_to_publish",
    wordpressVersion: "wp1",
  });
  expect(await auto.pendingPublication()).toEqual([
    { projectId: "p1", id: "queued" },
  ]);
  expect(await auto.claimPublication("p2", "queued")).toBe(false);
  expect(await auto.claimPublication("p1", "manual")).toBe(false);
  expect(await auto.claimPublication("p1", "queued")).toBe(true);
  expect(await auto.claimPublication("p1", "queued")).toBe(false);
});

it("leaves the queue alone while execution is paused", async () => {
  await savePolicy(true, null);
  await jobs.create({
    ...agencyJob("queued"),
    state: "ready_to_publish",
    wordpressVersion: "wp1",
  });
  await savePolicy(false, (await jobs.policy("p1")).version);
  expect(await auto.pendingPublication()).toEqual([]);
  expect((await jobs.job("p1", "queued"))?.state).toBe("ready_to_publish");
});
