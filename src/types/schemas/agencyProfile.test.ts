import { describe, expect, it } from "vitest";
import {
  agencyProfilePatchSchema,
  agencyProfileUpdates,
  readAgencyProfile,
} from "./agencyProfile";
describe("agency profile", () => {
  it("rejects unknown fields, non-US zones and oversized content", () => {
    for (const fields of [
      { timezone: "Europe/London" },
      { services: "x".repeat(2001) },
      { projectId: "other" },
      {},
    ])
      expect(
        agencyProfilePatchSchema.safeParse({ projectId: "pilot", fields })
          .success,
      ).toBe(false);
  });
  it("patches only changed fields and preserves unrelated context", () => {
    const input = agencyProfilePatchSchema.parse({
      projectId: "pilot",
      fields: { services: "  Web design  ", timezone: "America/Denver" },
    });
    expect(agencyProfileUpdates(input.fields)).toEqual([
      {
        customSection: "agency-services",
        title: "Services to promote",
        content: "Web design",
      },
      {
        customSection: "agency-timezone",
        title: "Agency reporting time zone",
        content: "America/Denver",
      },
    ]);
    expect(
      readAgencyProfile([
        { slug: "agency-services", content: "Web design" },
        { slug: "unrelated", content: "Keep me" },
      ]),
    ).toEqual({ services: "Web design" });
  });
  it("allows a fresh profile without a readiness gate and permits explicit clearing", () => {
    expect(
      agencyProfilePatchSchema.parse({
        projectId: "pilot",
        fields: { exclusions: "" },
      }).fields,
    ).toEqual({ exclusions: "" });
  });
});
