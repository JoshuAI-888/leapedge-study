"use client";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  useRef,
  type ReactNode,
} from "react";
import { usePathname } from "next/navigation";
import {
  Activity,
  RunPage,
  applyActivity,
  mergeRunSummaries,
} from "./activity-state.ts";
import type { ResearchSnapshot } from "../../../server/youtube-intelligence/actions/research.ts";
import type { Run } from "../contracts.ts";
import type {
  TeamPreferencesData,
  AccountPreferencesData,
  ResolvedAccountPreferencesData,
} from "../settings.ts";
import type { loadCostMetrics } from "../../../server/youtube-intelligence/cost-metrics.ts";
import { request, action } from "./api.ts";
export type Preferences = {
  defaults: TeamPreferencesData;
  team: TeamPreferencesData;
  account: AccountPreferencesData;
  resolved: ResolvedAccountPreferencesData;
};
export type WorkspaceData = {
  snapshot: ResearchSnapshot;
  runs: Run[];
  preferences: Preferences;
  cost: Awaited<ReturnType<typeof loadCostMetrics>>;
};
type Workspace = {
  data: WorkspaceData | null;
  loading: boolean;
  error: string;
  dismissError: () => void;
  refresh: () => Promise<void>;
  loadMoreRuns: () => Promise<void>;
  hasMoreRuns: boolean;
  loadingMoreRuns: boolean;
  busy: boolean;
  notice: string;
  perform: (
    operation: () => Promise<unknown>,
    success: string,
  ) => Promise<boolean>;
};
const Context = createContext<Workspace | null>(null);
export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<WorkspaceData | null>(null),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [actionError, setActionError] = useState(""),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState("");
  const pathname = usePathname();
  const epoch = useRef(0),
    refreshing = useRef(false),
    alive = useRef(true);
  const loadedRuns = useRef<Run[]>([]);
  useEffect(() => {
    loadedRuns.current = data?.runs ?? [];
  }, [data?.runs]);
  const activity = useRef<ReturnType<typeof Activity.parse> | null>(null);
  const moreLock = useRef(false),
    paginationInitialized = useRef(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMoreRuns, setLoadingMoreRuns] = useState(false);
  const refresh = useCallback(async () => {
    const ticket = ++epoch.current;
    refreshing.current = true;
    const start = performance.now();
    try {
      // Read the revision BEFORE the snapshot: a completion during the snapshot
      // remains visible to the next activity poll instead of being acknowledged early.
      const status = Activity.parse(
        await request("/api/intelligence/activity"),
      );
      const [snapshot, page, preferences, cost] = await Promise.all([
        action<ResearchSnapshot>("research", "snapshot"),
        request("/api/intelligence/runs?limit=50").then((value) =>
          RunPage.parse(value),
        ),
        action<Preferences>("settings", "teamAccount"),
        action<WorkspaceData["cost"]>("channels", "costMetrics"),
      ]);
      if (!alive.current || ticket !== epoch.current) return;
      const visible = new Set(page.runs.map((run) => run.id));
      const missing = [
        ...new Set([
          ...loadedRuns.current.map((run) => run.id),
          ...status.active.map((run) => run.id),
        ]),
      ].filter((id) => !visible.has(id));
      let updated = page.runs;
      // Refresh loaded history and active jobs beyond page one. Each projection
      // is capped at100 IDs; sequential batches bound browser request pressure.
      for (let offset = 0; offset < missing.length; offset += 100) {
        if (!alive.current || ticket !== epoch.current) return;
        const extra = RunPage.parse(
          await request(
            `/api/intelligence/runs?ids=${encodeURIComponent(missing.slice(offset, offset + 100).join(","))}`,
          ),
        );
        updated = mergeRunSummaries(updated, extra.runs);
      }
      if (!alive.current || ticket !== epoch.current) return;
      activity.current = status;
      setData((previous) => ({
        snapshot,
        runs: mergeRunSummaries(previous?.runs ?? [], updated),
        preferences,
        cost,
      }));
      // Retain the pagination position when refreshed after a job completes.
      if (!paginationInitialized.current) {
        setNextCursor(page.nextCursor);
        paginationInitialized.current = true;
      }
      setError("");
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          if (alive.current && ticket === epoch.current) {
            performance.measure("yti:workspace-request-to-paint", {
              start,
              end: performance.now(),
            });
            window.dispatchEvent(
              new CustomEvent("yti:workspace-painted", {
                detail: {
                  at: Date.now(),
                  elapsedMs: performance.now() - start,
                  terminalRevision: status.terminalRevision,
                },
              }),
            );
          }
        }),
      );
    } catch (e) {
      if (alive.current && ticket === epoch.current)
        setError(
          e instanceof Error ? e.message : "Unable to load your workspace.",
        );
    } finally {
      if (alive.current && ticket === epoch.current) {
        refreshing.current = false;
        setLoading(false);
      }
    }
  }, []);
  useEffect(() => {
    alive.current = true;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        if (!refreshing.current && document.visibilityState === "visible") {
          const ticket = epoch.current;
          const next = Activity.parse(
            await request("/api/intelligence/activity"),
          );
          if (stopped || ticket !== epoch.current) return;
          const previous = activity.current;
          setError("");
          if (
            !previous ||
            next.terminalRevision !== previous.terminalRevision ||
            next.latestRunId !== previous.latestRunId
          ) {
            await refresh();
          } else if (JSON.stringify(next) !== JSON.stringify(previous)) {
            activity.current = next;
            setData((current) =>
              current
                ? {
                    ...current,
                    runs: applyActivity(current.runs, next),
                    snapshot: {
                      ...current.snapshot,
                      jobs: current.snapshot.jobs.map((job) => {
                        const status = next.active.find((r) => r.id === job.id);
                        return status ? { ...job, ...status } : job;
                      }),
                    },
                  }
                : current,
            );
            setError("");
          }
        }
      } catch (e) {
        if (!stopped)
          setError(
            e instanceof Error ? e.message : "Live status updates unavailable.",
          );
      } finally {
        if (!stopped) timer = setTimeout(() => void poll(), 2000);
      }
    }
    void refresh().then(() => {
      if (!stopped) timer = setTimeout(() => void poll(), 2000);
    });
    return () => {
      stopped = true;
      alive.current = false;
      ++epoch.current;
      clearTimeout(timer);
    };
  }, [refresh, pathname]);
  async function loadMoreRuns() {
    if (!nextCursor || moreLock.current) return;
    moreLock.current = true;
    setLoadingMoreRuns(true);
    const ticket = epoch.current;
    try {
      const page = RunPage.parse(
        await request(
          `/api/intelligence/runs?limit=50&cursor=${encodeURIComponent(nextCursor)}`,
        ),
      );
      if (alive.current && ticket === epoch.current) {
        setData((current) =>
          current
            ? { ...current, runs: mergeRunSummaries(current.runs, page.runs) }
            : current,
        );
        setNextCursor(page.nextCursor);
      }
    } catch (e) {
      if (alive.current)
        setError(
          e instanceof Error ? e.message : "Unable to load older videos.",
        );
    } finally {
      moreLock.current = false;
      if (alive.current) setLoadingMoreRuns(false);
    }
  }
  async function perform(operation: () => Promise<unknown>, success: string) {
    setBusy(true);
    setNotice("");
    setActionError("");
    try {
      await operation();
      setNotice(success);
      await refresh();
      return true;
    } catch (e) {
      setActionError(
        e instanceof Error ? e.message : "Could not save the change.",
      );
      return false;
    } finally {
      setBusy(false);
    }
  }
  return (
    <Context.Provider
      value={{
        data,
        loading,
        error: actionError || error,
        dismissError: () => {
          setError("");
          setActionError("");
        },
        refresh,
        loadMoreRuns,
        hasMoreRuns: nextCursor !== null,
        loadingMoreRuns,
        busy: busy || data?.snapshot.integrations.readOnly === true,
        notice,
        perform,
      }}
    >
      {children}
    </Context.Provider>
  );
}
export function useWorkspace() {
  const value = useContext(Context);
  if (!value) throw Error("Workspace provider missing");
  return value;
}
