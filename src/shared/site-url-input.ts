/** Syntax check shared by the audit form and server URL normalizer. */
export function getSiteUrlSyntaxError(input: string): string | null {
  const raw = input.trim();
  if (!raw) return "Please enter a website URL.";

  const hasScheme = /^https?:\/\//i.test(raw);
  const remainder = hasScheme ? raw.replace(/^https?:\/\//i, "") : raw;
  if (
    (/^https?:/i.test(raw) && !hasScheme) ||
    /^https?\/\//i.test(raw) ||
    /^https?:/i.test(remainder) ||
    /^https?\/\//i.test(remainder) ||
    (!hasScheme && /^[a-z][a-z0-9+.-]*:\/\//i.test(raw))
  ) {
    return "Enter one complete website address, such as https://example.com. Remove duplicated or incomplete https:// text.";
  }

  try {
    const parsed = new URL(hasScheme ? raw : `https://${raw}`);
    if (!parsed.hostname || !["http:", "https:"].includes(parsed.protocol))
      return "Enter a valid website address, such as https://example.com.";
  } catch {
    return "Enter a valid website address, such as https://example.com.";
  }
  return null;
}
