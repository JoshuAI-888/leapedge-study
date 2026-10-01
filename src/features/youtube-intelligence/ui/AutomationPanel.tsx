"use client";
import { useEffect, useState } from "react";
import { action } from "./api.ts";
import { useWorkspace } from "./workspace.tsx";
import { Collapsible } from "./components.tsx";
export function AutomationPanel() {
  const { data, perform, busy } = useWorkspace();
  const [channel, setChannel] = useState(""),
    [maxVideos, setMaxVideos] = useState(1),
    [pages, setPages] = useState(1),
    [result, setResult] = useState<{
      queued: unknown[];
      skipped: { videoId: string; reason: string }[];
      message: string;
    } | null>(null),
    [status, setStatus] = useState<unknown>(null),
    [statusError, setStatusError] = useState("");
  useEffect(() => {
    action("automation", "automationStatus")
      .then((value) => {
        setStatus(value);
        setStatusError("");
      })
      .catch((e) => setStatusError(e.message));
  }, [data]);
  if (!data) return null;
  const eligible = data.snapshot.channels.filter(
    (c) => ["1", "tier1"].includes(c.tier ?? "") && c.active && c.followedAt,
  );
  return (
    <section className="yi-panel">
      <h2>Historical replay</h2>
      <p>
        Replay older Tier 1 uploads from{" "}
        {data.preferences.team.channels.historicalReplay.from}. These are
        labelled historical and never added to the forward record.
      </p>
      <p className="yi-warning">
        This action reads YouTube metadata and queues paid batch analyses. The
        video limit bounds this request; your per-video and monthly spending
        caps still apply.
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void perform(async () => {
            const response = await action<{
              result: NonNullable<typeof result>;
            }>("automation", "replayHistorical", {
              ...(channel ? { channelIds: [channel] } : {}),
              maxVideos,
              pagesPerChannel: pages,
            });
            setResult(response.result);
          }, "Bounded historical replay completed its queueing step.");
        }}
      >
        <div className="yi-settings-fields">
          <label>
            Channel
            <select
              value={channel}
              onChange={(e) => setChannel(e.target.value)}
            >
              <option value="">All followed Tier 1 channels</option>
              {eligible.map((c) => (
                <option value={c.id} key={c.id}>
                  {c.title}
                </option>
              ))}
            </select>
          </label>
          <label>
            Maximum videos this request
            <input
              required
              type="number"
              min={1}
              max={50}
              value={maxVideos}
              onChange={(e) => setMaxVideos(Number(e.target.value))}
            />
          </label>
          <label>
            Metadata pages per channel
            <input
              required
              type="number"
              min={0}
              max={3}
              value={pages}
              onChange={(e) => setPages(Number(e.target.value))}
            />
          </label>
        </div>
        <button disabled={busy || !eligible.length}>
          Queue up to {maxVideos} historical{" "}
          {maxVideos === 1 ? "video" : "videos"}
        </button>
        {!eligible.length && (
          <p className="yi-muted">
            Enable discovery for a Tier 1 catalog channel first.
          </p>
        )}
      </form>
      {result && (
        <div role="status">
          <p>
            {result.queued.length} queued · {result.skipped.length} skipped.
          </p>
          <p>{result.message}</p>
          <Collapsible title="Replay decisions">
            <ul>
              {result.skipped.map((row, i) => (
                <li key={`${row.videoId}:${i}`}>
                  {row.videoId}: {row.reason}
                </li>
              ))}
            </ul>
          </Collapsible>
        </div>
      )}
      <Collapsible title="Batch, subscription and replay status">
        {statusError ? (
          <p role="alert">{statusError}</p>
        ) : (
          <pre>{JSON.stringify(status, null, 2)}</pre>
        )}
      </Collapsible>
    </section>
  );
}
