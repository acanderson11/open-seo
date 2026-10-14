/** Safe user-facing messages; response bodies and headers are never persisted. */
export function inventoryReadMessage(
  reason: string | null,
  status: number | null,
) {
  const prefix = status ? `HTTP ${status}: ` : "";
  switch (reason) {
    case "siteground-challenge":
      return (
        prefix +
        "SiteGround's anti-bot challenge prevented this read. Ask the host to permit your authorized OpenSEO scanner. This is not evidence of a page SEO defect."
      );
    case "challenge":
      return (
        prefix +
        "A bot challenge prevented this read. Review crawler access with the host."
      );
    case "redirect":
      return (
        prefix +
        "This URL redirects. Review the destination in Site Audit; content has not been attributed to the source URL."
      );
    case "http-incomplete":
      return (
        prefix +
        "The server did not return a complete page response. Retry or investigate with the host."
      );
    case "empty-content":
      return (
        prefix +
        "The response contained no usable page text. It may be a challenge or a JavaScript-only page."
      );
    case "empty-or-oversized":
      return (
        prefix +
        "The response was empty or exceeded the two-megabyte scan limit."
      );
    case "url-validation":
      return "The URL could not pass the public-URL safety check.";
    case "not-html":
      return prefix + "The response was not readable HTML.";
    default:
      return (
        prefix +
        "The page could not be read. Retry or investigate in Site Audit."
      );
  }
}
