"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { read } from "./api.ts";

export const PAGE_SIZE = 50;

type Paged<R> = { rows: R[]; total: number; nextOffset: number | null };
type State<P> = {
  /** The last response for the current input's first page (facets, aggregates). */
  data: P | null;
  /** Every row loaded so far for the input `data` answers. */
  key: string;
  error: string;
};

/**
 * A paged read from the query API (F56). Changing `input` refetches the first
 * page while the previous result stays on screen (`stale` is true until the new
 * page lands), so a refetch dims the list rather than flashing a skeleton.
 * `loadMore` appends the next page of 50. An aborted request is ignored.
 */
export function useQueryPages<R, P extends Paged<R>>(
  action: string,
  input: Record<string, unknown> | null,
) {
  const key = input === null ? "" : JSON.stringify(input);
  const [state, setState] = useState<State<P>>({ data: null, key: "", error: "" });
  const [rows, setRows] = useState<R[]>([]);
  const [loadingMore, setLoadingMore] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const current = useRef(key);
  current.current = key;
  useEffect(() => {
    if (!key) return;
    const controller = new AbortController();
    read<P>("query", action, { ...JSON.parse(key), limit: PAGE_SIZE, offset: 0 }, controller.signal)
      .then((data) => {
        if (controller.signal.aborted) return;
        setState({ data, key, error: "" });
        setRows(data.rows);
      })
      .catch((e: unknown) => {
        if (controller.signal.aborted) return;
        setState((s) => ({ ...s, key, error: e instanceof Error ? e.message : String(e) }));
      });
    return () => controller.abort();
  }, [action, key, attempt]);
  const loadMore = useCallback(async () => {
    const data = state.data;
    if (!data || data.nextOffset === null || loadingMore) return;
    const at = state.key;
    setLoadingMore(true);
    try {
      const next = await read<P>("query", action, {
        ...JSON.parse(at),
        limit: PAGE_SIZE,
        offset: rows.length,
      });
      if (current.current !== at) return;
      setRows((r) => [...r, ...next.rows]);
      setState((s) => (s.key === at ? { ...s, data: { ...s.data!, total: next.total, nextOffset: next.nextOffset } } : s));
    } catch (e) {
      setState((s) => ({ ...s, error: e instanceof Error ? e.message : String(e) }));
    } finally {
      setLoadingMore(false);
    }
  }, [action, state, rows.length, loadingMore]);
  return {
    data: state.data,
    rows,
    stale: state.key !== key && !state.error,
    error: state.key === key ? state.error : "",
    loadingMore,
    loadMore,
    retry: () => setAttempt((n) => n + 1),
  };
}
