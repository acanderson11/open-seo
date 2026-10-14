import { normalizeAndValidateStartUrl } from "@/server/lib/audit/url-policy";
import { Parser } from "htmlparser2";
import { SITE_USER_AGENT } from "@/shared/site-user-agent";

type Check = {
  outcome: string;
  detail: string;
  clicks?: number;
  impressions?: number;
  issue?: string;
};
async function readBounded(response: Response, maxBytes = 256_000) {
  const reader = response.body?.getReader();
  if (!reader) return null;
  const decoder = new TextDecoder();
  let bytes = 0;
  let html = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) return html + decoder.decode();
    bytes += value.byteLength;
    if (bytes > maxBytes) {
      await reader.cancel();
      return null;
    }
    html += decoder.decode(value, { stream: true });
  }
}

function indexDirectives(html: string) {
  const directives: string[] = [];
  const parser = new Parser(
    {
      onopentag(name, attributes) {
        if (name !== "meta") return;
        const target = attributes.name?.toLowerCase();
        if (["robots", "googlebot"].includes(target ?? ""))
          directives.push(attributes.content ?? "");
      },
    },
    { decodeEntities: true },
  );
  parser.write(html);
  parser.end();
  return directives;
}

async function sitemapObservation(articleUrl: string): Promise<string> {
  const target = new URL(articleUrl);
  const sources = [
    `${target.origin}/sitemap.xml`,
    `${target.origin}/wp-sitemap.xml`,
  ];
  try {
    const robotsResponse = await fetch(
      await normalizeAndValidateStartUrl(`${target.origin}/robots.txt`),
      {
        headers: { "user-agent": SITE_USER_AGENT },
        redirect: "manual",
        signal: AbortSignal.timeout(8_000),
      },
    );
    if (robotsResponse.status === 200) {
      const robots = await readBounded(robotsResponse, 64_000);
      for (const match of robots?.matchAll(/^sitemap:\s*(\S+)/gim) ?? []) {
        if (sources.length >= 5) break;
        sources.push(match[1]);
      }
    } else await robotsResponse.body?.cancel();
  } catch {
    /* Robots access is optional evidence. */
  }
  let checked = 0;
  const visited = new Set<string>();
  const queue = [...sources];
  while (queue.length > 0 && visited.size < 8) {
    const source = queue.shift()!;
    if (visited.has(source)) continue;
    visited.add(source);
    try {
      const safe = await normalizeAndValidateStartUrl(source);
      if (new URL(safe).origin !== target.origin) continue;
      const response = await fetch(safe, {
        headers: { "user-agent": SITE_USER_AGENT },
        redirect: "manual",
        signal: AbortSignal.timeout(8_000),
      });
      if (response.status !== 200) {
        await response.body?.cancel();
        continue;
      }
      const xml = await readBounded(response);
      if (!xml || /<html|sgcaptcha|cf-chl-/i.test(xml.slice(0, 1000))) continue;
      checked++;
      const locations = [...xml.matchAll(/<loc>\s*([^<]+?)\s*<\/loc>/gi)].map(
        (match) => match[1].replaceAll("&amp;", "&").trim(),
      );
      if (locations.some((location) => location === articleUrl))
        return " The URL appears in a checked sitemap.";
      if (/<sitemapindex[\s>]/i.test(xml)) {
        const children = locations.filter((location) => {
          try {
            return (
              new URL(location).origin === target.origin &&
              /\.xml(?:\?|$)/i.test(location)
            );
          } catch {
            return false;
          }
        });
        children.sort(
          (a, b) =>
            Number(/post|article|blog/i.test(b)) -
            Number(/post|article|blog/i.test(a)),
        );
        queue.push(
          ...children.slice(0, Math.max(0, 8 - checked - queue.length)),
        );
      }
    } catch {
      /* Sitemap access is optional evidence. */
    }
  }
  return checked > 0
    ? " The URL was not found in the checked sitemaps; this bounded scan does not cover every sitemap."
    : " Sitemap inclusion could not be confirmed.";
}

export async function technicalCheck(url: string): Promise<Check> {
  let safeUrl: string;
  try {
    safeUrl = await normalizeAndValidateStartUrl(url);
  } catch {
    return {
      outcome: "unavailable",
      detail: "The published URL could not be safely checked.",
    };
  }
  try {
    const response = await fetch(safeUrl, {
      headers: { accept: "text/html", "user-agent": SITE_USER_AGENT },
      redirect: "manual",
      signal: AbortSignal.timeout(10_000),
    });
    const status = response.status;
    if (
      response.headers.get("sg-captcha") === "challenge" ||
      response.headers.get("cf-mitigated") === "challenge" ||
      status === 403 ||
      status === 429
    ) {
      await response.body?.cancel();
      return {
        outcome: "unavailable",
        detail:
          "The site blocked or challenged the check; page health is unconfirmed.",
      };
    }
    if (status === 404 || status === 410) {
      const body = await readBounded(response);
      if (
        body &&
        /\/\.well-known\/sgcaptcha\/|cf-chl-|checking your browser|just a moment|verify you are human/i.test(
          body.slice(0, 12000),
        )
      )
        return {
          outcome: "unavailable",
          detail: "The site returned a challenge; page health is unconfirmed.",
        };
      return {
        outcome: "issue",
        detail: `The published URL returned HTTP ${status}.`,
        issue: `The published article returns HTTP ${status}. Confirm the URL and restore or redirect the page.`,
      };
    }
    if (status !== 200) {
      await response.body?.cancel();
      return {
        outcome: "unavailable",
        detail: `The page returned HTTP ${status}; no indexability conclusion was made.`,
      };
    }
    const html = await readBounded(response);
    if (
      !html ||
      /\/\.well-known\/sgcaptcha\/|cf-chl-|checking your browser|just a moment|verify you are human/i.test(
        html.slice(0, 12000),
      )
    )
      return {
        outcome: "unavailable",
        detail:
          "The page could not be read completely or returned a challenge.",
      };
    const robotsHeader = response.headers.get("x-robots-tag") ?? "";
    const directives = [robotsHeader, ...indexDirectives(html)];
    if (
      directives.some((value) =>
        /(?:^|[,\s])(?:noindex|none)(?:$|[,\s])/i.test(value),
      )
    )
      return {
        outcome: "issue",
        detail: "The live page declares noindex.",
        issue:
          "The published article declares noindex. Review the page's robots settings before requesting indexing.",
      };
    const sitemap = await sitemapObservation(safeUrl);
    return {
      outcome: "healthy",
      detail: `The published URL returned HTTP 200 and no noindex directive was detected.${sitemap}`,
    };
  } catch {
    return {
      outcome: "unavailable",
      detail: "The site could not be reached; page health is unconfirmed.",
    };
  }
}
