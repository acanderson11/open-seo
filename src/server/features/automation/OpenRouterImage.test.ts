import { z } from "zod";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  env: vi.fn(async (name: string) =>
    name === "OPENROUTER_API_KEY" ? "fixture-key" : undefined,
  ),
  decode: vi.fn(() => new Uint8Array([1, 2, 3])),
}));
vi.mock("@/server/lib/runtime-env", () => ({ getOptionalEnvValue: mocks.env }));
vi.mock("./FeaturedImageCodec", () => ({ decodeImageBase64: mocks.decode }));
import {
  classifyProviderRequestFailure,
  generateConceptualImage,
  IMAGE_PROMPT_LIMIT,
} from "./OpenRouterImage";

beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.unstubAllGlobals());

describe("OpenRouter image response contract", () => {
  it("sends one bounded non-streaming image request and records provider cost", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () =>
      Response.json({
        data: [{ b64_json: "A".repeat(100) }],
        usage: { cost: 0.007 },
      }),
    );
    vi.stubGlobal("fetch", fetch);
    const result = await generateConceptualImage(
      "p".repeat(IMAGE_PROMPT_LIMIT + 100),
    );
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0]?.[0]).toBe(
      "https://openrouter.ai/api/v1/images",
    );
    const request = fetch.mock.calls[0]?.[1];
    expect(request?.redirect).toBe("manual");
    const body = z
      .object({ prompt: z.string() })
      .passthrough()
      .parse(JSON.parse(z.string().parse(request?.body)));
    expect(body).toMatchObject({
      model: "recraft/recraft-v4.1-flash",
      aspect_ratio: "16:9",
      n: 1,
    });
    expect(body.prompt).toHaveLength(IMAGE_PROMPT_LIMIT);
    expect(result).toMatchObject({
      model: "recraft/recraft-v4.1-flash",
      costUsd: "0.007",
    });
  });
  it("uses static diagnostic categories without saving raw provider errors", async () => {
    expect(
      classifyProviderRequestFailure(
        new TypeError("redirect blocked; token=sensitive"),
      ),
    ).toBe("failed while applying redirect policy");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("redirect blocked; token=sensitive");
      }),
    );
    await expect(generateConceptualImage("brief")).rejects.toThrow(
      "redirect policy",
    );
    await expect(generateConceptualImage("brief")).rejects.not.toThrow(
      "sensitive",
    );
  });
  it("rejects an HTTP redirect without following it or exposing query credentials", async () => {
    const fetch = vi.fn(
      async () =>
        new Response(null, {
          status: 307,
          headers: {
            location: "https://other.example/images/new?token=sensitive#frag",
          },
        }),
    );
    vi.stubGlobal("fetch", fetch);
    await expect(generateConceptualImage("brief")).rejects.toThrow(
      "HTTP 307 redirect to https://other.example/images/new; no credentials were forwarded",
    );
    expect(fetch).toHaveBeenCalledTimes(1);
    await expect(generateConceptualImage("brief")).rejects.not.toThrow(
      "sensitive",
    );
  });
  it("identifies malformed image response shape without exposing the response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({ data: [{ url: "https://example.com/image.png" }] }),
      ),
    );
    await expect(generateConceptualImage("brief")).rejects.toThrow(
      "did not contain one valid raster image",
    );
  });
});
