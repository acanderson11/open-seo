import { afterEach, expect, it, vi } from "vitest";
vi.mock("@/server/lib/runtime-env", () => ({
  getOptionalEnvValue: async () => "test-key",
}));
vi.mock("./FeaturedImageCodec", () => ({
  encodeImageBase64: () => "test-image",
}));
import { captionConceptualImage } from "./OpenRouterImageCaption";
afterEach(() => vi.unstubAllGlobals());
const response = (content: unknown) =>
  Response.json({
    choices: [{ message: { content: JSON.stringify(content) } }],
  });

it("returns the visual reason for a rejected image", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      response({
        alt: "A monitor displaying invented application labels.",
        forbidden: true,
        reason: "Letters appear on the monitor.",
      }),
    ),
  );
  expect(await captionConceptualImage(new Uint8Array([1]))).toEqual({
    alt: "A monitor displaying invented application labels.",
    forbidden: true,
    reason: "Letters appear on the monitor.",
  });
});

it("accepts a valid no-text caption when an older provider response omits the optional reason", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      response({
        alt: "Unmarked boxes arranged beside a coil of cable.",
        forbidden: false,
      }),
    ),
  );
  expect(await captionConceptualImage(new Uint8Array([1]))).toEqual({
    alt: "Unmarked boxes arranged beside a coil of cable.",
    forbidden: false,
    reason: "",
  });
});

it("does not invent a rejection reason or usable caption for invalid provider output", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => response({ alt: "Too short", forbidden: "no" })),
  );
  expect(await captionConceptualImage(new Uint8Array([1]))).toEqual({
    alt: "",
    forbidden: false,
  });
});
