export type WordpressConnectionFailure =
  | "challenge"
  | "credentials"
  | "permission"
  | "rest_api"
  | "redirect"
  | "network"
  | "invalid_response";

export class WordpressConnectionError extends Error {
  constructor(public readonly reason: WordpressConnectionFailure) {
    super(reason);
    this.name = "WordpressConnectionError";
  }
}

export function classifyWordpressVerificationResponse(
  response: Response,
): WordpressConnectionFailure | null {
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  if (
    response.status === 202 ||
    (response.status === 403 && contentType.includes("html"))
  )
    return "challenge";
  if (response.status === 401) return "credentials";
  if (response.status === 403) return "permission";
  if (response.status === 404) return "rest_api";
  if (response.status >= 300 && response.status < 400) return "redirect";
  if (!response.ok || !contentType.includes("json")) return "invalid_response";
  return null;
}
