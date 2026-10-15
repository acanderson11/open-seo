import { afterEach, expect, it, vi } from "vitest";
import { z } from "zod";

const m = vi.hoisted(() => ({ env: vi.fn() }));
vi.mock("@/server/lib/runtime-env", () => ({ getOptionalEnvValue: m.env }));
import { sendReviewEmail } from "./ReviewEmail";

afterEach(() => vi.unstubAllGlobals());

const email = {
  to: "client@example.com",
  title: "Why software costs grow\nfast",
  reviewUrl: "https://review.example.com/review#token",
  expiresDays: 14,
  delivery: "manual" as const,
  idempotencyKey: "review-link/hash",
};

it("sends one idempotent email whose wording matches the project's delivery", async () => {
  m.env.mockImplementation(async (name: string) =>
    name === "RESEND_API_KEY" ? "re_test" : "Agency <reviews@example.com>",
  );
  const fetch = vi.fn<typeof globalThis.fetch>(
    async () => new Response("{}", { status: 200 }),
  );
  vi.stubGlobal("fetch", fetch);
  await sendReviewEmail(email);
  const init = fetch.mock.calls[0]?.[1];
  expect(new Headers(init?.headers).get("idempotency-key")).toBe(
    "review-link/hash",
  );
  const body = z
    .object({ to: z.array(z.string()), subject: z.string(), text: z.string() })
    .parse(JSON.parse(z.string().parse(init?.body)));
  expect(body.to).toEqual(["client@example.com"]);
  expect(body.subject).toBe(
    "Article ready for approval: Why software costs grow fast",
  );
  expect(body.text).toContain("Nothing is published automatically");
  expect(body.text).not.toContain("WordPress");
});

it("refuses to send without Resend configuration", async () => {
  m.env.mockResolvedValue(undefined);
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  await expect(sendReviewEmail(email)).rejects.toThrow("RESEND_API_KEY");
  expect(fetch).not.toHaveBeenCalled();
});
