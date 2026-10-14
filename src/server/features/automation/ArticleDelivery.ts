import { AutomationRepository as jobs } from "./AutomationRepository";
import { AutopilotRepository as auto } from "./AutopilotRepository";

/**
 * Where an article goes once it is approved, decided at approval time from the
 * project's current delivery setting. Only new articles publish to WordPress;
 * refreshes of existing pages, and projects without a verified connection, are
 * delivered by hand.
 */
export async function approvedDelivery(projectId: string, kind: string) {
  const [policy, connection] = await Promise.all([
    jobs.policy(projectId),
    auto.wordpress(projectId),
  ]);
  if (policy?.delivery === "wordpress" && connection && kind === "new_content")
    return {
      state: "ready_to_publish",
      wordpressVersion: connection.version,
    } as const;
  return {
    state: "ready_for_manual_publication",
    wordpressVersion: null,
  } as const;
}
