import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({
  search: vi.fn(),
  pages: vi.fn(),
  hosted: vi.fn(),
  save: vi.fn(),
  project: vi.fn(),
}));
vi.mock("@/server/lib/dataforseo", () => ({
  createDataforseoClient: () => ({
    serp: { live: async () => (await m.search()).data },
  }),
}));
vi.mock("@/server/lib/dataforseo/serp", () => ({ fetchLiveSerp: m.search }));
vi.mock("@/server/lib/runtime-env", () => ({
  isHostedServerAuthMode: m.hosted,
}));
vi.mock("@/server/lib/scrape", () => ({ readPages: m.pages }));
vi.mock("./ArticleResearchRepository", () => ({
  ArticleResearchRepository: { save: m.save },
}));
vi.mock("@/server/features/projects/repositories/ProjectRepository", () => ({
  ProjectRepository: { getProjectById: m.project },
}));
import {
  researchPublicSources,
  researchArticle,
} from "./ArticleResearchService";
const project = { locationCode: 2840, languageCode: "en" };
beforeEach(() => {
  vi.resetAllMocks();
  m.hosted.mockResolvedValue(false);
  m.project.mockResolvedValue(project);
  m.search.mockResolvedValue({
    data: [
      {
        type: "organic",
        url: "https://research.example/study",
        title: "Snippet",
        description: "Unverified snippet statistic",
      },
    ],
  });
  m.pages.mockResolvedValue({
    pages: [
      {
        url: "https://research.example/study",
        title: "Actual study",
        text: "Retrieved evidence ".repeat(20),
      },
    ],
  });
});
it("reads actual pages, deduplicates results and persists version-scoped sources", async () => {
  const sources = await researchArticle("p", "j", 2, "Audience changes");
  expect(m.search).toHaveBeenCalledTimes(2);
  expect(m.pages).toHaveBeenCalledTimes(1);
  expect(sources[0].text).toContain("Retrieved evidence");
  expect(sources[0].text).not.toContain("Unverified snippet");
  expect(m.save).toHaveBeenCalledWith([
    expect.objectContaining({
      projectId: "p",
      jobId: "j",
      artifactVersion: 2,
      title: "Actual study",
    }),
  ]);
});
it("does not block writing when searches or page reads fail", async () => {
  m.search.mockRejectedValue(new Error("unavailable"));
  expect(await researchPublicSources("Topic", project)).toEqual([]);
  m.search.mockResolvedValue({
    data: [{ type: "organic", url: "https://example.com" }],
  });
  m.pages.mockRejectedValue(new Error("blocked"));
  expect(await researchPublicSources("Topic", project)).toEqual([]);
});
it("does not bypass hosted billing or fetch credential-bearing URLs", async () => {
  m.hosted.mockResolvedValue(true);
  expect(await researchPublicSources("Topic", project)).toEqual([]);
  expect(m.search).not.toHaveBeenCalled();
  m.hosted.mockResolvedValue(false);
  m.search.mockResolvedValue({
    data: [
      { type: "organic", url: "https://user:secret@example.com" },
      { type: "organic", url: "file:///private" },
    ],
  });
  expect(await researchPublicSources("Topic", project)).toEqual([]);
  expect(m.pages).not.toHaveBeenCalled();
});
