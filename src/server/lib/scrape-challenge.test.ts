import { afterEach, expect, it, vi } from "vitest";
vi.mock("@/server/lib/audit/url-policy", () => ({
  normalizeAndValidateStartUrl: async (url: string) => new URL(url).href,
}));
import { readPages } from "./scrape";
afterEach(() => vi.unstubAllGlobals());
it.each([
  new Response(
    "<html><body>Complete-looking but unconfirmed content.</body></html>",
    { status: 202 },
  ),
  new Response("<html><body>A browser challenge.</body></html>", {
    headers: { "sg-captcha": "challenge" },
  }),
  new Response(
    '<html><head><meta http-equiv="refresh" content="0;/.well-known/sgcaptcha/?r=%2F"></head><body>Continue to our site.</body></html>',
  ),
  new Response("<html><body>Verify you are human</body></html>", {
    headers: { "cf-mitigated": "challenge" },
  }),
])(
  "rejects challenges and partial responses as website evidence",
  async (response) => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => response),
    );
    expect(await readPages(["https://example.com/"])).toEqual({
      pages: [],
      blocked: true,
    });
  },
);
it("also rejects a challenge after a validated redirect", async () => {
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(
      new Response(null, {
        status: 301,
        headers: { location: "https://example.com/page/" },
      }),
    )
    .mockResolvedValueOnce(
      new Response("<html>Challenge content</html>", {
        status: 202,
        headers: { "sg-captcha": "challenge" },
      }),
    );
  vi.stubGlobal("fetch", fetch);
  expect((await readPages(["https://example.com/"])).pages).toEqual([]);
  expect(fetch).toHaveBeenCalledTimes(2);
});
it("keeps normal complete pages readable", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(
          "<html><head><title>Services</title></head><body><h1>Our services</h1><p>Details about the work we provide.</p></body></html>",
        ),
    ),
  );
  const result = await readPages(["https://example.com/"]);
  expect(result.blocked).toBe(false);
  expect(result.pages[0].title).toBe("Services");
  expect(result.pages[0].text).toContain("Details about the work");
});
