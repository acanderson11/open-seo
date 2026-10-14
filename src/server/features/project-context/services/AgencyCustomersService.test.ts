import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ env: vi.fn() }));
vi.mock("@/server/lib/runtime-env", () => ({ getOptionalEnvValue: mocks.env }));
import { previewCustomers } from "./AgencyCustomersService";
beforeEach(() => {
  vi.unstubAllGlobals();
  mocks.env.mockResolvedValue("test-key");
});
describe("Customers read-only integration", () => {
  it("reports missing configuration without fetching", async () => {
    mocks.env.mockResolvedValue(undefined);
    const fetcher = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetcher);
    expect(await previewCustomers("andmktg.com")).toEqual({
      connected: false,
      records: [],
    });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("returns only domain-matched allowlisted fields and uses a fixed destination", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: [
            {
              id: 13,
              WebsiteURL: "https://www.andmktg.com",
              Services: "Web design",
              Email: "private@example.com",
            },
            {
              id: 14,
              WebsiteURL: "https://other.com",
              Services: "Other secret",
            },
          ],
        }),
      ),
    );
    vi.stubGlobal("fetch", fetcher);
    const result = await previewCustomers("andmktg.com");
    expect(result.records).toHaveLength(1);
    expect(JSON.stringify(result)).not.toContain("private@example.com");
    expect(JSON.stringify(result)).not.toContain("Other secret");
    const requested = fetcher.mock.calls[0][0];
    expect(requested).toBeInstanceOf(URL);
    if (requested instanceof URL)
      expect(requested.origin).toBe("https://n8n.andmktg.com");
    expect(fetcher.mock.calls[0][1]?.redirect).toBe("manual");
  });
  it("rejects redirects without forwarding the API key", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(null, {
        status: 302,
        headers: { Location: "https://evil.com" },
      }),
    );
    vi.stubGlobal("fetch", fetcher);
    await expect(previewCustomers("andmktg.com")).rejects.toMatchObject({
      code: "UPSTREAM_UNAVAILABLE",
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("rejects repeated cursors rather than returning partial results", async () => {
    const fetcher = vi
      .fn()
      .mockImplementation(() =>
        Promise.resolve(
          new Response(JSON.stringify({ data: [], nextCursor: "repeat" })),
        ),
      );
    vi.stubGlobal("fetch", fetcher);
    await expect(previewCustomers("andmktg.com")).rejects.toMatchObject({
      code: "UPSTREAM_UNAVAILABLE",
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
