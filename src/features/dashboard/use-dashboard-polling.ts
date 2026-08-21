"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { ApiClientError } from "@/lib/api/client";

const SUCCESS_INTERVAL_MS = 30_000;
const RETRY_DELAYS_MS = [30_000, 60_000, 120_000, 240_000, 300_000] as const;

export type DashboardPollingState<T> = {
  data?: T;
  error?: string;
  isLoading: boolean;
  isStale: boolean;
  retry: () => void;
};

type DashboardPollingOptions<T> = {
  fetcher: (signal: AbortSignal) => Promise<T>;
  onAuthRequired: () => void;
  onForbidden: () => void;
};

function isAbortError(error: unknown): boolean {
  return (error instanceof DOMException && error.name === "AbortError")
    || (typeof error === "object" && error !== null && "name" in error && error.name === "AbortError");
}

export function useDashboardPolling<T>({
  fetcher,
  onAuthRequired,
  onForbidden,
}: DashboardPollingOptions<T>): DashboardPollingState<T> {
  const [state, setState] = useState<Omit<DashboardPollingState<T>, "retry">>({
    isLoading: true,
    isStale: false,
  });
  const retryRef = useRef<() => void>(() => undefined);

  useEffect(() => {
    let mounted = true;
    let terminal = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let activeRequest: { controller: AbortController; generation: number } | undefined;
    let queuedVisibleRefresh = false;
    let generation = 0;
    let failureCount = 0;
    let lastSuccessAt: number | undefined;

    const clearTimer = () => {
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
    };

    const schedule = (delay: number) => {
      clearTimer();
      if (!mounted || terminal || document.visibilityState !== "visible") return;
      timer = setTimeout(() => {
        timer = undefined;
        void refresh();
      }, delay);
    };

    const stopForTerminalError = (code: "AUTH_REQUIRED" | "FORBIDDEN") => {
      if (terminal) return;
      terminal = true;
      generation += 1;
      queuedVisibleRefresh = false;
      clearTimer();
      activeRequest?.controller.abort();
      setState({ isLoading: false, isStale: false });
      if (code === "AUTH_REQUIRED") onAuthRequired();
      else onForbidden();
    };

    async function refresh(): Promise<void> {
      if (!mounted || terminal || activeRequest || document.visibilityState !== "visible") return;
      queuedVisibleRefresh = false;
      const requestController = new AbortController();
      const request = { controller: requestController, generation: ++generation };
      activeRequest = request;
      setState((current) => ({
        ...current,
        error: current.data ? current.error : undefined,
        isLoading: !current.data,
      }));

      try {
        const data = await fetcher(requestController.signal);
        if (!mounted || terminal || requestController.signal.aborted || request.generation !== generation) return;
        failureCount = 0;
        lastSuccessAt = Date.now();
        setState({ data, isLoading: false, isStale: false });
        schedule(SUCCESS_INTERVAL_MS);
      } catch (caught: unknown) {
        if (!mounted || terminal || request.generation !== generation || isAbortError(caught)) return;
        if (caught instanceof ApiClientError && (caught.code === "AUTH_REQUIRED" || caught.code === "FORBIDDEN")) {
          stopForTerminalError(caught.code);
          return;
        }
        failureCount += 1;
        const message = caught instanceof ApiClientError
          ? caught.message
          : "대시보드를 새로 고치지 못했습니다.";
        setState((current) => ({
          ...current,
          error: message,
          isLoading: false,
          isStale: current.data !== undefined,
        }));
        schedule(RETRY_DELAYS_MS[Math.min(failureCount - 1, RETRY_DELAYS_MS.length - 1)]);
      } finally {
        if (activeRequest !== request) return;
        activeRequest = undefined;
        if (!mounted || terminal || document.visibilityState !== "visible" || !queuedVisibleRefresh) return;
        queuedVisibleRefresh = false;
        const remaining = lastSuccessAt === undefined
          ? 0
          : Math.max(0, SUCCESS_INTERVAL_MS - (Date.now() - lastSuccessAt));
        if (remaining === 0) void refresh();
        else schedule(remaining);
      }
    }

    retryRef.current = () => {
      if (!mounted || terminal) return;
      clearTimer();
      void refresh();
    };

    const onVisibilityChange = () => {
      clearTimer();
      if (document.visibilityState === "hidden") {
        generation += 1;
        queuedVisibleRefresh = false;
        activeRequest?.controller.abort();
        setState((current) => ({ ...current, isLoading: false }));
        return;
      }
      if (terminal) return;
      if (activeRequest) {
        queuedVisibleRefresh = true;
        return;
      }
      const remaining = lastSuccessAt === undefined
        ? 0
        : Math.max(0, SUCCESS_INTERVAL_MS - (Date.now() - lastSuccessAt));
      if (remaining === 0) void refresh();
      else schedule(remaining);
    };

    document.addEventListener("visibilitychange", onVisibilityChange);
    if (document.visibilityState === "visible") void refresh();

    return () => {
      mounted = false;
      generation += 1;
      queuedVisibleRefresh = false;
      clearTimer();
      activeRequest?.controller.abort();
      retryRef.current = () => undefined;
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [fetcher, onAuthRequired, onForbidden]);

  const retry = useCallback(() => retryRef.current(), []);
  return { ...state, retry };
}
