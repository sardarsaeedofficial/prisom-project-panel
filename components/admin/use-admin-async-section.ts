"use client";

/**
 * components/admin/use-admin-async-section.ts
 *
 * Sprint 42: React hook for Admin Console async sections.
 *
 * Manages loading → slow → success/error state transitions with timeouts.
 * Preserves stale data across refreshes so the UI never goes blank.
 *
 * Safety rules:
 *  - Never calls browser alert
 *  - Ignores stale responses from aborted loads (ref-guard pattern)
 *  - Never throws to callers — errors are captured in state
 */

import { useState, useCallback, useRef } from "react";
import type { AdminAsyncSectionState }   from "./admin-async-section-state";

type UseAdminAsyncSectionOptions<T> = {
  sectionName:  string;
  load:         () => Promise<
    { ok: true; data: T; generatedAt?: string; cacheStatus?: string } |
    { ok: false; error: string; staleData?: T | null; staleGeneratedAt?: string }
  >;
  timeoutMs?:   number;   // default 12000
  slowAfterMs?: number;   // default 3000
  initialData?: T | null; // server-provided initial value (shown immediately)
  onError?:     (err: string) => void;
};

type UseAdminAsyncSectionReturn<T> = {
  state:   AdminAsyncSectionState<T>;
  retry:   () => void;
  refresh: () => void;
};

const DEFAULT_TIMEOUT_MS  = 12_000;
const DEFAULT_SLOW_AFTER  = 3_000;

export function useAdminAsyncSection<T>({
  sectionName,
  load,
  timeoutMs   = DEFAULT_TIMEOUT_MS,
  slowAfterMs = DEFAULT_SLOW_AFTER,
  initialData = null,
  onError,
}: UseAdminAsyncSectionOptions<T>): UseAdminAsyncSectionReturn<T> {
  // Use a load-counter to ignore stale responses
  const loadCount = useRef(0);

  const initialState: AdminAsyncSectionState<T> = initialData != null
    ? { status: "success", data: initialData, startedAt: Date.now(), finishedAt: Date.now(), durationMs: 0, cacheStatus: "hit" }
    : { status: "idle" };

  const [state, setState] = useState<AdminAsyncSectionState<T>>(initialState);

  // Keep a ref in sync so execute() can read the latest state without
  // adding `state` to its useCallback deps (which would re-create it too often).
  const stateRef = useRef<AdminAsyncSectionState<T>>(initialState);
  stateRef.current = state;

  const execute = useCallback(() => {
    const thisLoad = ++loadCount.current;
    const startedAt = Date.now();

    // Capture stale data from the current state (via ref to avoid stale closure)
    const prevData = stateRef.current.data ?? null;

    setState({
      status:    "loading",
      data:      prevData,
      startedAt,
      slow:      false,
    });

    // Slow timer
    const slowTimer = setTimeout(() => {
      setState((prev) => {
        if (prev.status === "loading" && loadCount.current === thisLoad) {
          return { ...prev, slow: true };
        }
        return prev;
      });
    }, slowAfterMs);

    // Timeout timer
    const timeoutTimer = setTimeout(() => {
      if (loadCount.current !== thisLoad) return;
      clearTimeout(slowTimer);
      const finishedAt = Date.now();
      setState((prev) => {
        const stale = prev.status === "loading" ? (prev.data ?? null) : null;
        return {
          status:      "error",
          data:        stale,
          startedAt,
          finishedAt,
          durationMs:  finishedAt - startedAt,
          error:       `${sectionName} timed out after ${Math.round(timeoutMs / 1000)}s.`,
          canRetry:    true,
          cacheStatus: stale ? "stale" : undefined,
        };
      });
      onError?.(`${sectionName} timed out`);
    }, timeoutMs);

    load()
      .then((res) => {
        if (loadCount.current !== thisLoad) return; // stale
        clearTimeout(slowTimer);
        clearTimeout(timeoutTimer);
        const finishedAt = Date.now();

        if (res.ok) {
          const cacheHit = res.cacheStatus === "fresh" || res.cacheStatus === "hit"
            ? "hit"
            : res.cacheStatus === "stale"
            ? "stale"
            : "miss";

          setState({
            status:      "success",
            data:        res.data,
            startedAt,
            finishedAt,
            durationMs:  finishedAt - startedAt,
            cacheStatus: cacheHit,
            generatedAt: res.generatedAt,
          });
        } else {
          const staleData = res.staleData ?? null;
          setState({
            status:      "error",
            data:        staleData,
            startedAt,
            finishedAt,
            durationMs:  finishedAt - startedAt,
            error:       res.error,
            canRetry:    true,
            cacheStatus: staleData ? "stale" : undefined,
            generatedAt: res.staleGeneratedAt,
          });
          onError?.(res.error);
        }
      })
      .catch((err) => {
        if (loadCount.current !== thisLoad) return;
        clearTimeout(slowTimer);
        clearTimeout(timeoutTimer);
        const finishedAt = Date.now();
        const msg = err instanceof Error ? err.message.split("\n")[0].slice(0, 200) : String(err).slice(0, 200);
        setState({
          status:     "error",
          data:       null,
          startedAt,
          finishedAt,
          durationMs: finishedAt - startedAt,
          error:      `${sectionName} failed: ${msg}`,
          canRetry:   true,
        });
        onError?.(msg);
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load, sectionName, slowAfterMs, timeoutMs]);

  return {
    state,
    retry:   execute,
    refresh: execute,
  };
}
