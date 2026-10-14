import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { getStandardErrorMessage } from "@/client/lib/error-messages";
import {
  createAutomationDraft,
  type getAutomation,
} from "@/serverFunctions/automation";
export function ContentDraftForm({
  projectId,
  topic: initialTopic = "",
  targetUrl: initialUrl = "",
  policy,
  onCreated,
}: {
  projectId: string;
  topic?: string;
  targetUrl?: string;
  policy: Awaited<ReturnType<typeof getAutomation>>["policy"];
  onCreated: (id: string) => void;
}) {
  const [topic, setTopic] = useState(initialTopic),
    [targetUrl, setTargetUrl] = useState(initialUrl),
    [requestKey, setRequestKey] = useState(() => crypto.randomUUID());
  const start = useMutation({
    mutationFn: () =>
      createAutomationDraft({
        data: { projectId, topic, targetUrl, requestKey },
      }),
    onSuccess: (job) => {
      if (job) onCreated(job.id);
    },
    onError: (error) =>
      toast.error(
        getStandardErrorMessage(
          error,
          "Could not start draft. Check the board before retrying.",
        ),
      ),
  });
  return (
    <>
      {" "}
      <h2 className="mb-3 font-semibold">Create a content draft</h2>{" "}
      <form
        className="space-y-3"
        onSubmit={(event) => {
          event.preventDefault();
          if (!start.isPending) start.mutate();
        }}
      >
        <label className="block text-sm">
          Search query or topic
          <input
            className="input input-bordered w-full"
            required
            minLength={3}
            maxLength={500}
            value={topic}
            disabled={start.isPending}
            onChange={(event) => {
              setTopic(event.target.value);
              setRequestKey(crypto.randomUUID());
            }}
          />
        </label>
        <label className="block text-sm">
          Existing page URL
          <input
            className="input input-bordered w-full"
            type="url"
            required
            value={targetUrl}
            disabled={start.isPending}
            onChange={(event) => {
              setTargetUrl(event.target.value);
              setRequestKey(crypto.randomUUID());
            }}
          />
        </label>
        <p className="text-xs text-base-content/60">
          Uses your saved Context and this public page for a brief, draft and
          review, with up to one correction and second review. Each accepted
          request reserves one monthly attempt, including failed runs.
          Allowances reset by UTC calendar month. Keep this page open while it
          runs.
        </p>
        <button
          className="btn btn-primary"
          disabled={start.isPending || !policy?.enabled || !!policy.busyJobId}
        >
          {start.isPending ? "Creating draft…" : "Create reviewed draft"}
        </button>
        {policy?.busyJobId && (
          <p role="status" className="text-sm">
            A job is reserved for this project. Uncertain outcomes need
            reconciliation before another run.
          </p>
        )}
      </form>
    </>
  );
}
