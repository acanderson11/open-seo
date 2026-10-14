import { toast } from "sonner";

type ScanPage = {
  url: string;
  readFailure: string | null;
  readStatus: number | null;
  checkedAt: string | null;
};

export function ScanAccessHelp({ pages }: { pages: ScanPage[] }) {
  const blocked = pages.filter(
    (page) => page.readFailure === "siteground-challenge",
  );
  if (!blocked.length) return null;
  let site = "this website";
  try {
    site = new URL(blocked[0].url).hostname;
  } catch {
    /* Keep the request usable if a historical URL is invalid. */
  }
  const request = [
    `Please help us permit our authorized OpenSEO scanner on ${site}, and advise how to apply the same configuration to the other websites we manage in our SiteGround account.`,
    "Our OpenSEO application runs at https://seo.andmktg.com on Cloudflare Workers. Page reads receive HTTP 202 with sg-captcha: challenge instead of website HTML.",
    "Scanner and WordPress REST requests use the exact User-Agent: OpenSEO.",
    "Cloudflare Workers do not provide one fixed outbound IP for these requests. Please advise a supported, narrowly scoped crawler exception; if you require fixed IPs or another verification method, please tell us before making changes.",
    "Keep general anti-bot protection and WordPress authentication in place. The WordPress integration must still require its application password. We are not asking to allow all Cloudflare traffic.",
    "Observed examples:",
    ...blocked
      .slice(0, 3)
      .map(
        (page) =>
          `${page.url.slice(0, 1000)} — HTTP ${page.readStatus ?? 202}, checked ${page.checkedAt ?? "date unavailable"}`,
      ),
  ].join("\n\n");
  return (
    <details className="mt-3 rounded border border-warning/40 p-3 text-sm">
      <summary className="cursor-pointer font-medium">
        Resolve SiteGround scan access
      </summary>
      <div className="mt-3 space-y-3">
        <p>
          SiteGround challenged {blocked.length} page reads. This limits the
          plan’s evidence; it does not show that the pages have SEO defects.
        </p>
        <p>
          Open SiteGround’s Help Center and ask support to permit your
          authorized scanner. Copy the details below into the request. After
          support confirms access, run Scan website again.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            className="btn btn-outline btn-sm"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(request);
                toast.success("Hosting support request copied.");
              } catch {
                toast.error("Could not copy. Select the request text below.");
              }
            }}
          >
            Copy support request
          </button>
          <a
            className="link"
            href="https://www.siteground.com/kb/ai-crawlers-siteground-servers/"
            target="_blank"
            rel="noreferrer"
          >
            SiteGround crawler guidance
          </a>
        </div>
        <details>
          <summary className="cursor-pointer text-base-content/70">
            View request details
          </summary>
          <pre className="mt-2 whitespace-pre-wrap break-words rounded bg-base-200 p-3 font-sans text-xs">
            {request}
          </pre>
        </details>
      </div>
    </details>
  );
}
