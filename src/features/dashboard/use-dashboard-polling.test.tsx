import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import { ApiClientError } from "@/lib/api/client";
import { useDashboardPolling } from "./use-dashboard-polling";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, resolve, reject };
}

function setVisibility(value: "visible" | "hidden") {
  Object.defineProperty(document, "visibilityState", { configurable: true, value });
  document.dispatchEvent(new Event("visibilitychange"));
}

const noop = () => undefined;

function Harness({
  fetcher,
  onAuthRequired = noop,
  onForbidden = noop,
}: {
  fetcher: (signal: AbortSignal) => Promise<{ value: number }>;
  onAuthRequired?: () => void;
  onForbidden?: () => void;
}) {
  const state = useDashboardPolling({ fetcher, onAuthRequired, onForbidden });
  return <div>{state.isLoading ? <p>loading</p> : null}{state.data ? <p>value:{state.data.value}</p> : null}{state.error ? <p role="alert">{state.error}</p> : null}{state.isStale ? <p>stale</p> : null}<button type="button" onClick={state.retry}>retry</button></div>;
}

afterEach(() => {
  vi.useRealTimers();
  Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
});

it("fetches immediately without overlap and waits 30 seconds after successful completion", async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  const first = deferred<{ value: number }>();
  const fetcher = vi.fn().mockReturnValueOnce(first.promise).mockResolvedValue({ value: 2 });
  render(<Harness fetcher={fetcher} />);
  expect(fetcher).toHaveBeenCalledTimes(1);

  await act(async () => vi.advanceTimersByTimeAsync(60_000));
  expect(fetcher).toHaveBeenCalledTimes(1);
  await act(async () => first.resolve({ value: 1 }));
  expect(await screen.findByText("value:1")).toBeInTheDocument();

  await act(async () => vi.advanceTimersByTimeAsync(29_000));
  expect(fetcher).toHaveBeenCalledTimes(1);
  await act(async () => vi.advanceTimersByTimeAsync(1_000));
  expect(fetcher).toHaveBeenCalledTimes(2);
});

it("uses bounded exponential retries no faster than 30 seconds", async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  const fetcher = vi.fn().mockRejectedValue(new ApiClientError("REQUEST_FAILED", "실패"));
  render(<Harness fetcher={fetcher} />);
  await act(async () => Promise.resolve());
  expect(fetcher).toHaveBeenCalledTimes(1);

  for (const [index, delay] of [30_000, 60_000, 120_000, 240_000, 300_000, 300_000].entries()) {
    await act(async () => vi.advanceTimersByTimeAsync(delay - 1));
    expect(fetcher).toHaveBeenCalledTimes(index + 1);
    await act(async () => vi.advanceTimersByTimeAsync(1));
    expect(fetcher).toHaveBeenCalledTimes(index + 2);
  }
});

it("pauses while hidden, aborts current work, and honors the remaining success cadence", async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  const second = deferred<{ value: number }>();
  const signals: AbortSignal[] = [];
  const fetcher = vi.fn((signal: AbortSignal) => {
    signals.push(signal);
    return signals.length === 1 ? Promise.resolve({ value: 1 }) : second.promise;
  });
  render(<Harness fetcher={fetcher} />);
  expect(await screen.findByText("value:1")).toBeInTheDocument();

  await act(async () => vi.advanceTimersByTimeAsync(10_000));
  await act(async () => setVisibility("hidden"));
  await act(async () => vi.advanceTimersByTimeAsync(10_000));
  await act(async () => setVisibility("visible"));
  expect(fetcher).toHaveBeenCalledTimes(1);
  await act(async () => vi.advanceTimersByTimeAsync(9_000));
  expect(fetcher).toHaveBeenCalledTimes(1);
  await act(async () => vi.advanceTimersByTimeAsync(1_000));
  expect(fetcher).toHaveBeenCalledTimes(2);

  await act(async () => setVisibility("hidden"));
  expect(signals[1].aborted).toBe(true);
  await act(async () => vi.advanceTimersByTimeAsync(600_000));
  expect(fetcher).toHaveBeenCalledTimes(2);
});

it("manual retry is immediate, abort errors stay silent, and unmount cleans up", async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  const pending = deferred<{ value: number }>();
  let signal: AbortSignal | undefined;
  const fetcher = vi.fn()
    .mockRejectedValueOnce(new ApiClientError("REQUEST_FAILED", "일시 실패"))
    .mockImplementationOnce((nextSignal: AbortSignal) => {
      signal = nextSignal;
      return pending.promise;
    });
  const view = render(<Harness fetcher={fetcher} />);
  expect(await screen.findByRole("alert")).toHaveTextContent("일시 실패");
  fireEvent.click(screen.getByRole("button", { name: "retry" }));
  expect(fetcher).toHaveBeenCalledTimes(2);

  view.unmount();
  expect(signal?.aborted).toBe(true);
  await act(async () => pending.reject(new DOMException("aborted", "AbortError")));
  await act(async () => vi.advanceTimersByTimeAsync(600_000));
  expect(fetcher).toHaveBeenCalledTimes(2);
});

it("makes auth terminal, redirects once, and ignores an older aborted completion", async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  const old = deferred<{ value: number }>();
  const onAuthRequired = vi.fn();
  const fetcher = vi.fn()
    .mockReturnValueOnce(old.promise)
    .mockRejectedValueOnce(new ApiClientError("AUTH_REQUIRED", "로그인 필요"));
  render(<Harness fetcher={fetcher} onAuthRequired={onAuthRequired} />);

  await act(async () => setVisibility("hidden"));
  await act(async () => setVisibility("visible"));
  await vi.waitFor(() => expect(onAuthRequired).toHaveBeenCalledTimes(1));
  await act(async () => old.resolve({ value: 99 }));
  await act(async () => vi.advanceTimersByTimeAsync(600_000));
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(onAuthRequired).toHaveBeenCalledTimes(1);
  expect(screen.queryByText("value:99")).not.toBeInTheDocument();
});
