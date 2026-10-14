import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";
import {
  saveAutomationPolicy,
  type getAutomationSettings,
} from "@/serverFunctions/automation";
import { connectAutomationWordpress } from "@/serverFunctions/autopilot";
import {
  getErrorCode,
  getStandardErrorMessage,
} from "@/client/lib/error-messages";
type Data = Awaited<ReturnType<typeof getAutomationSettings>>;
const wordpressConnectionMessages = {
  challenge:
    "SiteGround or another security layer blocked the WordPress API request. Ask your host to allow authenticated requests to /wp-json/wp/v2/ from OpenSEO, then try again.",
  credentials:
    "WordPress rejected the credentials. Enter the WordPress username and a newly generated application password, not your login password.",
  permission:
    "This WordPress account needs permission to edit and publish posts. Use an Author, Editor, or Administrator account.",
  rest_api:
    "The WordPress REST API was not found. Enter the site's base URL, including its installation subfolder if it has one, and check that /wp-json/ is available.",
  redirect:
    "The WordPress API redirected the request. Enter the final HTTPS site URL shown in your browser and check whether the host redirects /wp-json/.",
  network:
    "OpenSEO could not reach the WordPress API. Check the site URL and ask your host whether server requests to /wp-json/ are blocked.",
  invalid_response:
    "The site did not return a valid WordPress API response. Check the site URL and any security or cache rule affecting /wp-json/.",
} as const;
export function AutopilotSettings({
  projectId,
  data,
  onSaved,
}: {
  projectId: string;
  data: Data;
  onSaved: () => Promise<unknown>;
}) {
  const policy = data.policy;
  const [delivery, setDelivery] = useState<"manual" | "wordpress">(
    policy?.delivery === "wordpress" ? "wordpress" : "manual",
  );
  const [enabled, setEnabled] = useState(!!policy?.enabled),
    [autopilot, setAutopilot] = useState(!!policy?.autopilot),
    [target, setTarget] = useState(policy?.monthlyTarget ?? 4),
    [limit, setLimit] = useState(policy?.monthlyLimit ?? 8),
    [approval, setApproval] = useState<"agency" | "client">(
      policy?.approval === "client" ? "client" : "agency",
    ),
    [email, setEmail] = useState(policy?.reviewerEmail ?? "");
  const save = useMutation({
    mutationFn: () =>
      saveAutomationPolicy({
        data: {
          projectId,
          enabled,
          delivery,
          autopilot,
          monthlyTarget: target,
          monthlyLimit: limit,
          approval,
          reviewerEmail: email || undefined,
          expectedVersion: policy?.version ?? null,
        },
      }),
    onSuccess: () => {
      toast.success("Execution settings saved");
      void onSaved();
    },
    onError: (error) =>
      toast.error(
        getStandardErrorMessage(
          error,
          "Check the selected delivery method, review email, Context and monthly limits.",
        ),
      ),
  });
  return (
    <div className="space-y-6">
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          save.mutate();
        }}
      >
        <fieldset disabled={save.isPending} className="space-y-4">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              className="checkbox checkbox-sm"
              checked={enabled}
              onChange={(event) => setEnabled(event.target.checked)}
            />
            Enable content execution
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              className="checkbox checkbox-sm"
              checked={autopilot}
              onChange={(event) => setAutopilot(event.target.checked)}
            />
            Automatically find opportunities and produce articles
          </label>
          <p className="text-sm text-base-content/65">
            Reviews the site's search data, business goals and target topics.
            Drafts are paced across the month. Each article must pass quality
            review and your selected approval before delivery.
          </p>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="text-sm">
              Monthly article target
              <input
                className="input input-bordered w-full"
                type="number"
                min={1}
                max={20}
                value={target}
                onChange={(event) => setTarget(Number(event.target.value))}
              />
            </label>
            <label className="text-sm">
              Maximum monthly planning/draft attempts
              <input
                className="input input-bordered w-full"
                type="number"
                min={target}
                max={100}
                value={limit}
                onChange={(event) => setLimit(Number(event.target.value))}
              />
            </label>
          </div>
          <p className="text-xs text-base-content/60">
            A target of 4 aims for four quality-checked drafts ready for
            approval, not four attempts. Skipped and failed planning runs count
            toward the attempt cap. The system can deliver fewer when evidence
            or quality is insufficient. Monthly accounting uses UTC; at most one
            new planning run per day.
          </p>
          <label className="block text-sm">
            Delivery after approval
            <select
              aria-label="Delivery after approval"
              className="select select-bordered w-full"
              value={delivery}
              onChange={(event) =>
                setDelivery(
                  event.target.value === "wordpress" ? "wordpress" : "manual",
                )
              }
            >
              <option value="manual">Manual copy/paste</option>
              <option value="wordpress">
                Publish to this project’s WordPress site
              </option>
            </select>
          </label>
          <p className="text-sm text-base-content/65">
            Manual delivery includes automated research, writing, revisions and
            approval. Copy the approved article from the execution board when
            you are ready. WordPress is optional; each project has its own
            connection.
          </p>
          <label className="block text-sm">
            Who approves?
            <select
              aria-label="Who approves?"
              className="select select-bordered w-full"
              value={approval}
              onChange={(event) =>
                setApproval(
                  event.target.value === "client" ? "client" : "agency",
                )
              }
            >
              <option value="agency">Agency</option>
              <option value="client">Client</option>
            </select>
          </label>
          <label className="block text-sm">
            Reviewer's email
            <input
              type="email"
              className="input input-bordered w-full"
              required={autopilot}
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </label>
          <p className="text-xs text-base-content/60">
            Review requests use private links that expire after 14 days. Anyone
            holding a link can review that one draft. Approval follows this
            project’s selected delivery method.
          </p>
          <button className="btn btn-primary btn-sm" disabled={save.isPending}>
            Save execution settings
          </button>
        </fieldset>
      </form>
      <p className="text-sm">
        This month: {data.stats.completed} quality-checked articles ·{" "}
        {data.stats.attempts} automatic planning attempts.
      </p>
      {policy?.lastPlanStatus && (
        <p role="status" className="text-sm">
          Latest run: {policy.lastPlanStatus}
        </p>
      )}
      <Link
        to="/p/$projectId/settings/context"
        params={{ projectId }}
        className="link text-sm"
      >
        Manage voice, goals, target topics and keywords in Context
      </Link>
      <WordpressConnection
        projectId={projectId}
        connection={data.wordpress}
        onSaved={onSaved}
      />
      {!data.reviewReady && (
        <p role="status" className="text-sm text-warning">
          Approval-link delivery must be configured before automatic runs can be
          enabled.
        </p>
      )}
    </div>
  );
}
function WordpressConnection({
  projectId,
  connection,
  onSaved,
}: {
  projectId: string;
  connection: Data["wordpress"];
  onSaved: () => Promise<unknown>;
}) {
  const [baseUrl, setBaseUrl] = useState(connection?.baseUrl ?? ""),
    [username, setUsername] = useState(connection?.username ?? ""),
    [password, setPassword] = useState(""),
    [connectionError, setConnectionError] = useState<string | null>(null);
  const connect = useMutation({
    mutationFn: () =>
      connectAutomationWordpress({
        data: { projectId, baseUrl, username, applicationPassword: password },
      }),
    onSuccess: (result) => {
      if (!result.connected) {
        setConnectionError(wordpressConnectionMessages[result.reason]);
        return;
      }
      setPassword("");
      setConnectionError(null);
      toast.success("WordPress connection verified");
      void onSaved();
    },
    onError: (error) => {
      setConnectionError(
        getErrorCode(error) === "VALIDATION_ERROR"
          ? "Enter this project's HTTPS WordPress site URL, such as https://example.com. Do not enter /wp-admin, /wp-login.php, or /wp-json/."
          : getStandardErrorMessage(
              error,
              "Could not verify WordPress. Check the site URL, username, and application password.",
            ),
      );
    },
  });
  return (
    <section className="space-y-3 border-t border-base-300 pt-5">
      <h3 className="font-semibold">Optional WordPress connection</h3>
      <p className="text-sm">
        Credentials belong only to this project. Saving a connection does not
        enable automatic publishing; select WordPress delivery above to use it.
      </p>
      <p className="text-sm">
        {connection
          ? `Connected to ${connection.baseUrl}`
          : "Connect the site's WordPress REST API to publish approved articles automatically."}
      </p>
      <form
        className="space-y-3"
        onSubmit={(event) => {
          event.preventDefault();
          setConnectionError(null);
          connect.mutate();
        }}
      >
        <label className="block text-sm">
          WordPress site URL (for example, https://example.com)
          <input
            type="url"
            className="input input-bordered w-full"
            required
            placeholder="https://example.com"
            value={baseUrl}
            onChange={(event) => {
              setBaseUrl(event.target.value);
              setConnectionError(null);
            }}
          />
        </label>
        <p className="text-xs text-base-content/60">
          Use the public HTTPS site URL. Include a subfolder only if WordPress
          is installed there. Do not enter the login, admin, or REST API URL.
        </p>
        <label className="block text-sm">
          WordPress username
          <input
            className="input input-bordered w-full"
            required
            value={username}
            onChange={(event) => {
              setUsername(event.target.value);
              setConnectionError(null);
            }}
          />
        </label>
        <label className="block text-sm">
          Application password
          <input
            type="password"
            autoComplete="new-password"
            className="input input-bordered w-full"
            required
            value={password}
            onChange={(event) => {
              setPassword(event.target.value);
              setConnectionError(null);
            }}
          />
        </label>
        <p className="text-xs text-base-content/60">
          In WordPress, open Users → Profile → Application Passwords. Create one
          for OpenSEO using an author or editor account. The password is
          encrypted in storage and is never sent to AI. New articles publish as
          blog posts. Existing pages are not overwritten.
        </p>
        {connectionError && (
          <p role="alert" className="text-sm text-error">
            {connectionError}
          </p>
        )}
        <button className="btn btn-outline btn-sm" disabled={connect.isPending}>
          {connect.isPending ? "Verifying…" : "Verify and save WordPress"}
        </button>
      </form>
    </section>
  );
}
