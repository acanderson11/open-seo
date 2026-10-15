import { getOptionalEnvValue } from "@/server/lib/runtime-env";
import { AppError } from "@/server/lib/errors";

type ExecutionHook = "openseo-content-job" | "openseo-plan-content";

export async function executionSecret() {
  const secret = await getOptionalEnvValue("AGENCY_N8N_EXECUTION_SECRET");
  if (!secret)
    throw new AppError(
      "AUTH_CONFIG_MISSING",
      "The n8n execution connection is not configured.",
    );
  return secret;
}

/**
 * Builds an authenticated POST to an n8n webhook on AGENCY_N8N_ORIGIN. Missing
 * configuration throws here, before anything is sent, so callers can tell a
 * setup problem from a request whose outcome is unknown.
 */
export async function executionHookRequest(
  hook: ExecutionHook,
  payload: unknown,
  timeoutMs = 90_000,
) {
  const origin = await getOptionalEnvValue("AGENCY_N8N_ORIGIN");
  if (!origin)
    throw new AppError(
      "AUTH_CONFIG_MISSING",
      "Set AGENCY_N8N_ORIGIN to the n8n server's https origin.",
    );
  return new Request(new URL(`/webhook/${hook}`, origin), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-openseo-execution-secret": await executionSecret(),
    },
    body: JSON.stringify(payload),
    redirect: "manual",
    signal: AbortSignal.timeout(timeoutMs),
  });
}
