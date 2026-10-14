import { afterEach, expect, it, vi } from "vitest";
import { crawlPage } from "./site-audit-workflow-helpers";
import { runPageReporters } from "@/server/lib/audit/issues/page-reporters";
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
it.each<{ headers: Record<string, string>; body: string }>([
  { headers: { "sg-captcha": "challenge" }, body: "<html>Challenge</html>" },
  {
    headers: {},
    body: '<html><head><meta http-equiv="refresh" content="0;/.well-known/sgcaptcha/?r=%2F"></head></html>',
  },
])(
  "records SiteGround challenges as blocked, without false metadata findings",
  async ({ headers, body }) => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(body, {
          status: 202,
          headers: {
            ...headers,
            "content-type": "text/html",
            "x-robots-tag": "noindex",
          },
        }),
      ),
    );
    const page = await crawlPage(
      "https://example.com/private?token=secret",
      0,
      true,
    );
    expect(page.fetchClass).toBe("blocked");
    expect(page.isHtml).toBe(false);
    const diagnostic = JSON.stringify(warning.mock.calls);
    expect(diagnostic).toContain('"event":"audit-fetch-blocked"');
    expect(diagnostic).toContain('"url":"https://example.com/private"');
    expect(diagnostic).toContain('"userAgent":"OpenSEO"');
    expect(diagnostic).toContain('"status":202');
    expect(diagnostic).toContain(
      `"sgCaptcha":${JSON.stringify(headers["sg-captcha"] ?? null)}`,
    );
    expect(diagnostic).toContain(
      `"siteGroundBodyMarker":${body.includes("/.well-known/sgcaptcha/")}`,
    );
    expect(diagnostic).not.toContain("token=secret");
    expect(runPageReporters(page).map((x) => x.issueType)).toEqual([
      "blocked-page",
    ]);
  },
);
it.each([202, 204, 206])(
  "does not audit an incomplete %i representation",
  async (status) => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response(
            status === 204 ? null : "<html><body>Pending</body></html>",
            { status, headers: { "content-type": "text/html" } },
          ),
        ),
    );
    const page = await crawlPage("https://example.com/", 0, true);
    expect(page.fetchClass).toBe("error");
    expect(runPageReporters(page)).toEqual([]);
  },
);
it("retains normal missing metadata detection for real HTTP 200 HTML", async () => {
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValue(
        new Response(
          "<html><body><p>A real page with no title tag.</p></body></html>",
          { headers: { "content-type": "text/html" } },
        ),
      ),
  );
  const page = await crawlPage("https://example.com/", 0, true);
  expect(page.fetchClass).toBe("ok");
  expect(runPageReporters(page).map((x) => x.issueType)).toContain(
    "missing-title",
  );
});
