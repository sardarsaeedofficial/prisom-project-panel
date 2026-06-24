"use client";

/**
 * components/common/use-action-state.ts
 *
 * Sprint 56: Shared hook for consistent action state across panels.
 *
 * Features:
 *  - prevents duplicate submissions
 *  - normalizes thrown errors and { ok:false, error } results
 *  - preserves last successful action label
 *  - exposes startedAt/finishedAt timestamps
 */

import { useState, useRef, useCallback } from "react";
import { normalizeActionError }           from "@/lib/ui/action-error-normalizer";

export type ActionStatus = "idle" | "loading" | "success" | "error";

export type ActionState<T = unknown> = {
  status:      ActionStatus;
  actionName?: string;
  message?:    string;
  error?:      string;
  data?:       T;
  startedAt?:  string;
  finishedAt?: string;
};

type ActionFn<T> = () =>
  | Promise<{ ok: true; data: T } | { ok: false; error: string; code?: string }>
  | Promise<{ ok: true } | { ok: false; error: string; code?: string }>;

export function usePanelActionState<T = unknown>() {
  const [state,    setState]    = useState<ActionState<T>>({ status: "idle" });
  const inFlight                = useRef(false);

  const runAction = useCallback(async (
    actionName: string,
    fn: ActionFn<T>,
  ): Promise<boolean> => {
    if (inFlight.current) return false; // prevent duplicate submit
    inFlight.current = true;

    setState({ status: "loading", actionName, startedAt: new Date().toISOString() });

    try {
      const result = await (fn as () => Promise<{ ok: boolean; data?: T; error?: string }>)();
      const finishedAt = new Date().toISOString();
      if (result.ok) {
        setState({
          status:     "success",
          actionName,
          message:    actionName,
          data:       result.data as T | undefined,
          finishedAt,
        });
        return true;
      } else {
        const normalized = normalizeActionError(result.error ?? "Unknown error");
        setState({ status: "error", actionName, error: normalized.message, finishedAt });
        return false;
      }
    } catch (err) {
      const finishedAt = new Date().toISOString();
      setState({ status: "error", actionName, error: normalizeActionError(err).message, finishedAt });
      return false;
    } finally {
      inFlight.current = false;
    }
  }, []);

  const reset = useCallback(() => setState({ status: "idle" }), []);

  return [state, runAction, reset] as const;
}
