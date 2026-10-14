export const INVENTORY_LIMIT = 500;
export function inventoryUrl(raw: string, domain: string): string | null {
  try {
    const root = new URL(domain.includes("://") ? domain : `https://${domain}`);
    const u = new URL(raw, root);
    if (
      !["https:", "http:"].includes(u.protocol) ||
      u.username ||
      u.password ||
      u.port ||
      u.hostname.replace(/^www\./, "") !== root.hostname.replace(/^www\./, "")
    )
      return null;
    if (
      /\/(wp-admin|wp-login\.php|logout|cart|checkout|my-account)(\/|$)/i.test(
        u.pathname,
      ) ||
      [...u.searchParams.keys()].some((k) =>
        /^(action|add-to-cart|nonce|_wpnonce)$/i.test(k),
      )
    )
      return null;
    if (/\.(pdf|jpe?g|png|gif|svg|zip|xml|mp4|webp)$/i.test(u.pathname))
      return null;
    // Tracking parameters do not define a different page; preserve other query semantics.
    // Snapshot keys because deletion mutates the URLSearchParams iterator.
    const parameterKeys = [...u.searchParams.keys()];
    for (const key of parameterKeys)
      if (/^(utm_|gclid$|fbclid$)/i.test(key)) u.searchParams.delete(key);
    u.hash = "";
    u.searchParams.sort();
    return u.href;
  } catch {
    return null;
  }
}
export function pagePurpose(url: string, title: string, heading: string) {
  const path = new URL(url).pathname.toLowerCase();
  if (path === "/") return "Homepage";
  if (/contact|book|appointment/.test(path)) return "Contact / conversion";
  if (/case-stud|portfolio|projects/.test(path))
    return "Case study / portfolio";
  if (
    /blog|article|guide|how-to/.test(path) ||
    /^how\b/i.test(heading || title)
  )
    return "Article / guide";
  if (/service|solution|product/.test(path)) return "Service / product";
  if (/about|team/.test(path)) return "About / expertise";
  return "Needs classification";
}
const stop = new Set(
  "the a an and or for to of in on with by from is are your our you we at as it that this what how".split(
    " ",
  ),
);
export function topicTokens(text: string) {
  return new Set(
    (text.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter(
      (x) => x.length > 2 && !stop.has(x),
    ),
  );
}
export function topicOverlap(
  topic: string,
  page: { title: string; heading: string; url: string },
) {
  const wanted = topicTokens(topic),
    actual = topicTokens(
      `${page.title} ${page.heading} ${new URL(page.url).pathname}`,
    );
  return wanted.size
    ? [...wanted].filter((t) => actual.has(t)).length / wanted.size
    : 0;
}
export function needsInventoryRead(
  page: { checkedAt: string | null; readState: string; content?: string },
  now = Date.now(),
) {
  if (
    page.readState === "read" &&
    page.content !== undefined &&
    page.content.trim().length < 40
  )
    return true;
  return (
    !page.checkedAt ||
    now - Date.parse(page.checkedAt) >
      (page.readState === "read" ? 7 * 86400000 : 3600000)
  );
}
export async function evidenceHash(value: string) {
  return [
    ...new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
    ),
  ]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
