import { getOptionalEnvValue } from "@/server/lib/runtime-env";
import { AppError } from "@/server/lib/errors";

const RESEND_EMAILS_URL = "https://api.resend.com/emails";

/** Resend credentials for review emails. Throws before anything is claimed or sent. */
export async function reviewEmailConfig() {
  const [apiKey, from] = await Promise.all([
    getOptionalEnvValue("RESEND_API_KEY"),
    getOptionalEnvValue("AGENCY_REVIEW_EMAIL_FROM"),
  ]);
  if (!apiKey || !from)
    throw new AppError(
      "AUTH_CONFIG_MISSING",
      "Set RESEND_API_KEY and AGENCY_REVIEW_EMAIL_FROM to send review emails.",
    );
  return { apiKey, from };
}

/** Emails a private review link. The idempotency key stops Resend sending one link twice. */
export async function sendReviewEmail(email: {
  to: string;
  title: string;
  reviewUrl: string;
  expiresDays: number;
  delivery: "wordpress" | "manual";
  idempotencyKey: string;
}) {
  const { apiKey, from } = await reviewEmailConfig();
  const title = email.title.replace(/[\r\n]+/g, " ").slice(0, 500);
  const response = await fetch(RESEND_EMAILS_URL, {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
      "idempotency-key": email.idempotencyKey,
    },
    body: JSON.stringify({
      from,
      to: [email.to],
      subject: `Article ready for approval: ${title}`,
      text: [
        `Your article is ready to review: ${title}`,
        `Review it using this private link (expires in ${email.expiresDays} days):\n${email.reviewUrl}`,
        email.delivery === "wordpress"
          ? "Approving authorizes publishing this draft to your connected WordPress site."
          : "Approving marks this draft ready for publishing. Nothing is published automatically.",
        "Please do not forward this link.",
      ].join("\n\n"),
    }),
    redirect: "manual",
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw new AppError("UPSTREAM_UNAVAILABLE");
  }
  await response.body?.cancel();
}
