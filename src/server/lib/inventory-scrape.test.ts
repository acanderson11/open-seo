import { it, expect, vi, afterEach } from "vitest";
vi.mock("@/server/lib/audit/url-policy", () => ({
  normalizeAndValidateStartUrl: async (url: string) => new URL(url).href,
}));
import { readInventoryPage } from "./scrape";
afterEach(() => vi.unstubAllGlobals());
it("reuses the native analyzer to capture content and link evidence", async () => {
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValue(
        new Response(
          '<html><head><title>CRM</title><link rel="canonical" href="https://example.com/crm/"></head><body><h1>CRM services</h1><p>Real project details with specific examples and useful explanations.</p><a href="/contact/">Contact us</a></body></html>',
        ),
      ),
  );
  const page = await readInventoryPage("https://example.com/crm/");
  expect(page?.title).toBe("CRM");
  expect(page?.bodyText).toContain("Real project details");
  expect(page?.links[0]?.targetUrl).toBe("https://example.com/contact/");
});
it("does not attribute a redirect destination to the original URL", async () => {
  const fetch = vi.fn().mockResolvedValue(
    new Response(null, {
      status: 302,
      headers: { location: "https://other.example/" },
    }),
  );
  vi.stubGlobal("fetch", fetch);
  expect(await readInventoryPage("https://example.com/")).toBeNull();
  expect(fetch).toHaveBeenCalledTimes(1);
});
it("does not record a challenge or error as page content", async () => {
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(
      new Response("<html><title>Just a moment</title></html>"),
    )
    .mockResolvedValueOnce(new Response("Error", { status: 403 }));
  vi.stubGlobal("fetch", fetch);
  expect(await readInventoryPage("https://example.com/")).toBeNull();
  expect(await readInventoryPage("https://example.com/")).toBeNull();
});
it("rejects oversized response bodies", async () => {
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValue(
        new Response("<html>" + "a".repeat(2000001) + "</html>"),
      ),
  );
  expect(await readInventoryPage("https://example.com/")).toBeNull();
});

it("rejects empty HTML shells even when the server returns 200", async () => {
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValue(
        new Response("<html><body><script>challenge()</script></body></html>"),
      ),
  );
  expect(await readInventoryPage("https://example.com/")).toBeNull();
});

it("recognizes SiteGround challenges before reading or analyzing their body", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(
      new Response("<html>Host challenge</html>", {
        status: 202,
        headers: { "sg-captcha": "challenge" },
      }),
    ),
  );
  const diagnostic = vi.fn();
  expect(
    await readInventoryPage("https://example.com/", diagnostic),
  ).toBeNull();
  expect(diagnostic).toHaveBeenCalledWith({
    reason: "siteground-challenge",
    status: 202,
  });
});
it("recognizes a SiteGround meta-refresh shell without following it", async () => {
  const fetch = vi
    .fn()
    .mockResolvedValue(
      new Response(
        '<html><head><meta http-equiv="refresh" content="0;/.well-known/sgcaptcha/?r=%2F"></head></html>',
        { status: 202 },
      ),
    );
  vi.stubGlobal("fetch", fetch);
  const diagnostic = vi.fn();
  expect(
    await readInventoryPage("https://example.com/", diagnostic),
  ).toBeNull();
  expect(diagnostic).toHaveBeenCalledWith({
    reason: "siteground-challenge",
    status: 202,
  });
  expect(fetch).toHaveBeenCalledTimes(1);
});
it("rejects incomplete HTTP responses even when they contain plausible page text", async () => {
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValue(
        new Response(
          "<html><body>This looks like substantial page text but the server has not delivered a complete representation.</body></html>",
          { status: 202 },
        ),
      ),
  );
  const diagnostic = vi.fn();
  expect(
    await readInventoryPage("https://example.com/", diagnostic),
  ).toBeNull();
  expect(diagnostic).toHaveBeenCalledWith({
    reason: "http-incomplete",
    status: 202,
  });
});
