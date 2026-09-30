"use client";
import { useEffect, useState } from "react";
import { useWorkspace } from "./workspace.tsx";
import { action } from "./api.ts";
import { money } from "./viewmodel.ts";
import {
  dismissKey,
  dismissUntil,
  followPlan,
  isDismissed,
  isFollowed,
  uploadsText,
} from "../follow-prompt.ts";

function readDismissal(channelId: string) {
  try {
    return window.localStorage.getItem(dismissKey(channelId));
  } catch {
    return null;
  }
}

/**
 * The follow banner (F71) for a channel nobody follows yet: uploads per week,
 * the Channels page's cost projection and the budget left, with Follow and
 * Not now. Used under the Analysis verdict and on the channel page.
 */
export function FollowPrompt({
  channelId,
  channelTitle,
}: {
  channelId: string;
  channelTitle?: string | null;
}) {
  const { data, perform, busy } = useWorkspace();
  // Read after mount: storage is per browser and absent on the server.
  const [dismissed, setDismissed] = useState(true);
  const [processChoice, setProcessChoice] = useState<boolean | null>(null);
  useEffect(() => {
    setDismissed(isDismissed(readDismissal(channelId), Date.now()));
  }, [channelId]);
  if (!data || dismissed || isFollowed(channelId, data.snapshot.channels))
    return null;
  const plan = followPlan({
    channelId,
    context: data.cost.context,
    remainingUsd: data.cost.budget.remainingUsd,
  });
  const processing = processChoice ?? plan.processByDefault;
  const name = channelTitle || "This channel";
  const follow = () =>
    void perform(
      async () => {
        await action("channels", "follow", channelId);
        if (processing)
          await action("channels", "channel", {
            id: channelId,
            autoAnalyze: true,
          });
      },
      processing
        ? `${name} followed. New uploads will be analysed.`
        : `${name} followed for discovery only. Turn on processing in Channels when you are ready.`,
    );
  const notNow = () => {
    try {
      window.localStorage.setItem(dismissKey(channelId), dismissUntil(Date.now()));
    } catch {
      /* Blocked storage: hide for this view only. */
    }
    setDismissed(true);
  };
  return (
    <section className="yi-follow" aria-label={`Follow ${name}`}>
      <div className="yi-follow-text">
        <p>
          <strong>{name}</strong> isn&apos;t followed. Follow to see its new
          uploads.
        </p>
        <p className="yi-muted">
          {uploadsText(plan)} · est.{" "}
          {plan.monthlyUsd === null
            ? "cost not yet known"
            : `${money(plan.monthlyUsd)}/month`}{" "}
          · budget {money(plan.remainingUsd)} left
        </p>
        <label className="yi-checkbox yi-follow-process">
          <input
            type="checkbox"
            checked={processing}
            onChange={(e) => setProcessChoice(e.target.checked)}
          />{" "}
          Also analyse new uploads automatically
        </label>
        {plan.reason === "over-budget" && (
          <p className="yi-follow-note">
            Analysing its uploads would exceed the budget left this month, so
            Follow starts with discovery only.
          </p>
        )}
        {plan.reason === "cost-unknown" && (
          <p className="yi-follow-note">
            The monthly cost is not known yet, so Follow starts with discovery
            only. Switch on processing in Channels once uploads are observed.
          </p>
        )}
      </div>
      <div className="yi-row yi-follow-actions">
        <button type="button" disabled={busy} onClick={follow}>
          Follow
        </button>
        <button type="button" className="yi-secondary" onClick={notNow}>
          Not now
        </button>
      </div>
    </section>
  );
}
