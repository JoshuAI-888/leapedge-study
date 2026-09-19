"use client";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
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
  const refresh = useCallback(async () => {
    try {
      const [snapshot, runs, preferences, cost] = await Promise.all([
        action<ResearchSnapshot>("research", "snapshot"),
        request<{ runs: Run[] }>("/api/intelligence/runs"),
        action<Preferences>("settings", "teamAccount"),
        action<WorkspaceData["cost"]>("channels", "costMetrics"),
      ]);
      setData({ snapshot, runs: runs.runs, preferences, cost });
      setError("");
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Unable to load your workspace.",
      );
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void refresh();
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, 15000);
    return () => clearInterval(timer);
  }, [refresh]);
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
