import { describe, expect, it } from "vitest";
import { classifyWordpressVerificationResponse } from "./WordpressConnectionResponse";

describe("WordPress connection verification", () => {
  it.each([
    [202, "text/html", "challenge"],
    [403, "text/html", "challenge"],
    [401, "application/json", "credentials"],
    [403, "application/json", "permission"],
    [404, "application/json", "rest_api"],
    [301, "text/html", "redirect"],
    [200, "text/html", "invalid_response"],
    [500, "application/json", "invalid_response"],
    [200, "application/json", null],
  ] as const)(
    "classifies HTTP %i %s as %s",
    (status, contentType, expected) => {
      const response = new Response(null, {
        status,
        headers: { "content-type": contentType },
      });
      expect(classifyWordpressVerificationResponse(response)).toBe(expected);
    },
  );
});
