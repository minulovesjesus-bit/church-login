import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiClientError } from "@/lib/api/client";

const toCanvas = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
vi.mock("qrcode", () => ({ default: { toCanvas } }));

import { KioskScreen, type KioskClient } from "./kiosk-screen";
import { QrCard } from "./qr-card";

const NOW = new Date("2026-08-21T01:00:00.000Z");
const SESSION = {
  session_id: "4e06bff6-0e68-49ad-8840-0eb4d15d7f19",
  access_expires_at: "2026-08-21T01:15:00.000Z",
  refresh_expires_at: "2026-09-20T01:00:00.000Z",
};
const QR = {
  token: "signed-attendance-qr",
  issued_at: NOW.toISOString(),
  expires_at: new Date(NOW.getTime() + 20_000).toISOString(),
};
const EXPIRED_QR = {
  token: "already-expired-qr",
  issued_at: new Date(NOW.getTime() - 20_001).toISOString(),
  expires_at: new Date(NOW.getTime() - 1).toISOString(),
};

let resizeCallback: ResizeObserverCallback | undefined;
let announcementObservers: MutationObserver[] = [];

type DeferredRender = {
  resolve: () => void;
};

class TestResizeObserver implements ResizeObserver {
  constructor(callback: ResizeObserverCallback) {
    resizeCallback = callback;
  }

  disconnect = vi.fn();
  observe = vi.fn();
  unobserve = vi.fn();
}

function resizeQr(width: number) {
  const canvas = screen.getByRole("img", { name: "학생 출결용 QR 코드" });
  const target = canvas.parentElement;
  if (!target || !resizeCallback) throw new Error("QR resize observer is not ready");
  act(() => {
    resizeCallback?.([
      {
        target,
        contentRect: { width },
      } as unknown as ResizeObserverEntry,
    ], {} as ResizeObserver);
  });
}

function useDeferredQrRenderer(): DeferredRender[] {
  const renders: DeferredRender[] = [];
  toCanvas.mockImplementation((
    canvas: HTMLCanvasElement,
    token: string,
    options?: { width?: number },
  ) => {
    const width = Number(options?.width ?? 0);
    let resolveRender: (() => void) | undefined;
    const render = new Promise<void>((resolve) => {
      resolveRender = resolve;
    }).then(() => {
      canvas.width = width;
      canvas.height = width;
      canvas.dataset.pixelMarker = token;
    });
    renders.push({ resolve: () => resolveRender?.() });
    return render;
  });
  return renders;
}

function observeKioskAnnouncements() {
  const messages: string[] = [];
  const capture = () => {
    const message = document
      .querySelector('[role="status"][aria-live="polite"]')
      ?.textContent?.trim();
    if (message && messages.at(-1) !== message) messages.push(message);
  };
  const observer = new MutationObserver(capture);
  announcementObservers.push(observer);
  observer.observe(document.body, {
    childList: true,
    characterData: true,
    subtree: true,
  });
  return {
    disconnect: () => observer.disconnect(),
    messages,
  };
}

function createClient(): KioskClient {
  return {
    login: vi.fn().mockResolvedValue(SESSION),
    refresh: vi.fn().mockResolvedValue(SESSION),
    getQr: vi.fn().mockResolvedValue(QR),
    logout: vi.fn().mockResolvedValue(undefined),
  };
}

async function unlock(client: KioskClient) {
  render(<KioskScreen client={client} />);
  fireEvent.change(screen.getByLabelText("관리자 비밀번호"), {
    target: { value: "church-secret" },
  });
  fireEvent.click(screen.getByRole("button", { name: "QR 화면 열기" }));
  await flushAsyncWork();
  expect(screen.getByText("20초 후 갱신")).toBeInTheDocument();
}

async function flushAsyncWork() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function submitPassword(client: KioskClient) {
  render(<KioskScreen client={client} />);
  fireEvent.change(screen.getByLabelText("관리자 비밀번호"), {
    target: { value: "church-secret" },
  });
  fireEvent.click(screen.getByRole("button", { name: "QR 화면 열기" }));
  await flushAsyncWork();
}

function useStationaryClock() {
  vi.useRealTimers();
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  toCanvas.mockReset();
  toCanvas.mockImplementation(async (
    canvas: HTMLCanvasElement,
    token: string,
    options?: { width?: number },
  ) => {
    const width = Number(options?.width ?? 0);
    canvas.width = width;
    canvas.height = width;
    canvas.dataset.pixelMarker = token;
  });
  resizeCallback = undefined;
  announcementObservers = [];
  vi.stubGlobal("ResizeObserver", TestResizeObserver);
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(function (
    this: HTMLCanvasElement,
    contextId: string,
  ) {
    if (contextId !== "2d") return null;
    const target = this;
    return {
      clearRect: vi.fn(),
      drawImage(source: HTMLCanvasElement) {
        target.dataset.pixelMarker = source.dataset.pixelMarker ?? "";
      },
    } as unknown as CanvasRenderingContext2D;
  } as typeof HTMLCanvasElement.prototype.getContext);
});

afterEach(() => {
  announcementObservers.forEach((observer) => observer.disconnect());
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

it("starts with an accessible shared-password form and uses a generic rejection message", async () => {
  const client = createClient();
  vi.mocked(client.login).mockRejectedValue(
    new ApiClientError("KIOSK_LOGIN_FAILED", "server detail must not be echoed"),
  );
  render(<KioskScreen client={client} />);

  expect(screen.getByRole("heading", { name: "출결 QR 기기" })).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("관리자 비밀번호"), {
    target: { value: "wrong" },
  });
  fireEvent.click(screen.getByRole("button", { name: "QR 화면 열기" }));

  await flushAsyncWork();
  expect(screen.getByRole("alert")).toHaveTextContent(
    "관리자 비밀번호를 확인해 주세요.",
  );
  expect(screen.queryByText("server detail must not be echoed")).not.toBeInTheDocument();
});

it("keeps one QR for the full server lifetime and schedules the next request at expiry", async () => {
  useStationaryClock();
  const client = createClient();
  await submitPassword(client);

  expect(client.getQr).toHaveBeenCalledTimes(1);
  const untilExpiry = Date.parse(QR.expires_at) - Date.now();
  await act(() => vi.advanceTimersByTimeAsync(untilExpiry - 1));
  expect(client.getQr).toHaveBeenCalledTimes(1);

  await act(() => vi.advanceTimersByTimeAsync(1));
  expect(client.getQr).toHaveBeenCalledTimes(2);
});

it("keeps first issuance and timer ticks silent, then announces expiry and replacement", async () => {
  const replacement = {
    ...QR,
    token: "replacement-token",
    issued_at: new Date(NOW.getTime() + 20_000).toISOString(),
    expires_at: new Date(NOW.getTime() + 40_000).toISOString(),
  };
  let finishReplacement: ((value: typeof replacement) => void) | undefined;
  const client = createClient();
  vi.mocked(client.getQr)
    .mockResolvedValueOnce(QR)
    .mockImplementationOnce(() => new Promise((resolve) => {
      finishReplacement = resolve;
    }));
  const announcements = observeKioskAnnouncements();

  await unlock(client);

  expect(screen.getByRole("status")).toBeEmptyDOMElement();
  expect(announcements.messages).toEqual([]);
  await act(() => vi.advanceTimersByTimeAsync(19_000));
  expect(announcements.messages).toEqual([]);

  await act(() => vi.advanceTimersByTimeAsync(1_000));
  await flushAsyncWork();
  expect(announcements.messages).toEqual([
    "QR 코드가 만료되었습니다. 새 QR을 준비하고 있어요.",
  ]);

  await act(async () => finishReplacement?.(replacement));
  await flushAsyncWork();
  expect(announcements.messages).toEqual([
    "QR 코드가 만료되었습니다. 새 QR을 준비하고 있어요.",
    "새 QR 코드가 준비됐습니다.",
  ]);
  announcements.disconnect();
});

it("announces connection loss and recovery in order without retry-timer chatter", async () => {
  const recovered = {
    ...QR,
    token: "recovered-token",
    issued_at: new Date(NOW.getTime() + 1_000).toISOString(),
    expires_at: new Date(NOW.getTime() + 21_000).toISOString(),
  };
  let finishRecovery: ((value: typeof recovered) => void) | undefined;
  const client = createClient();
  vi.mocked(client.getQr)
    .mockRejectedValueOnce(new TypeError("offline"))
    .mockImplementationOnce(() => new Promise((resolve) => {
      finishRecovery = resolve;
    }));
  const announcements = observeKioskAnnouncements();

  await submitPassword(client);
  expect(announcements.messages).toEqual([
    "QR 연결이 끊어졌습니다. 연결을 다시 시도하고 있어요.",
  ]);

  await act(() => vi.advanceTimersByTimeAsync(999));
  expect(announcements.messages).toHaveLength(1);
  await act(() => vi.advanceTimersByTimeAsync(1));
  expect(announcements.messages).toHaveLength(1);

  await act(async () => finishRecovery?.(recovered));
  await flushAsyncWork();
  expect(announcements.messages).toEqual([
    "QR 연결이 끊어졌습니다. 연결을 다시 시도하고 있어요.",
    "QR 연결이 복구되고 새 QR 코드가 준비됐습니다.",
  ]);
  announcements.disconnect();
});

it("uses bounded failure backoff without overlapping QR requests", async () => {
  const client = createClient();
  let finishRetry: ((value: typeof QR) => void) | undefined;
  vi.mocked(client.getQr)
    .mockResolvedValueOnce(QR)
    .mockRejectedValueOnce(new TypeError("offline"))
    .mockImplementationOnce(() => new Promise((resolve) => {
      finishRetry = resolve;
    }));
  await unlock(client);

  await act(() => vi.advanceTimersByTimeAsync(Date.parse(QR.expires_at) - Date.now()));
  expect(screen.getByText("연결을 다시 시도하고 있어요")).toBeInTheDocument();
  expect(screen.getByRole("status")).toHaveTextContent(
    "QR 연결이 끊어졌습니다. 연결을 다시 시도하고 있어요.",
  );
  expect(screen.queryByRole("img", { name: "학생 출결용 QR 코드" })).not.toBeInTheDocument();
  const untilRetry = Date.parse(QR.expires_at) + 1_000 - Date.now();
  await act(() => vi.advanceTimersByTimeAsync(untilRetry - 1));
  expect(client.getQr).toHaveBeenCalledTimes(2);
  await act(() => vi.advanceTimersByTimeAsync(1));
  expect(client.getQr).toHaveBeenCalledTimes(3);
  await act(() => vi.advanceTimersByTimeAsync(10_000));
  expect(client.getQr).toHaveBeenCalledTimes(3);

  await act(async () => finishRetry?.({
    ...QR,
    issued_at: new Date(NOW.getTime() + 31_000).toISOString(),
    expires_at: new Date(NOW.getTime() + 51_000).toISOString(),
  }));
  expect(screen.getByText("QR 연결됨")).toBeInTheDocument();
  expect(screen.getByRole("status")).toHaveTextContent(
    "QR 연결이 복구되고 새 QR 코드가 준비됐습니다.",
  );
});

it("removes an expired QR while its replacement request is still pending", async () => {
  const client = createClient();
  vi.mocked(client.getQr)
    .mockResolvedValueOnce(QR)
    .mockImplementationOnce(() => new Promise(() => undefined));
  await unlock(client);

  await act(() => vi.advanceTimersByTimeAsync(Date.parse(QR.expires_at) - Date.now()));

  expect(client.getQr).toHaveBeenCalledTimes(2);
  expect(screen.queryByRole("img", { name: "학생 출결용 QR 코드" })).not.toBeInTheDocument();
  expect(screen.getByRole("status")).toHaveTextContent(
    "QR 코드가 만료되었습니다. 새 QR을 준비하고 있어요.",
  );
});

it("never renders an already-expired successful response and retries with bounded backoff", async () => {
  useStationaryClock();
  const client = createClient();
  vi.mocked(client.getQr).mockResolvedValue(EXPIRED_QR);
  await submitPassword(client);

  expect(client.getQr).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole("img", { name: "학생 출결용 QR 코드" })).not.toBeInTheDocument();
  expect(screen.getByRole("status")).toHaveTextContent("연결을 다시 시도하고 있어요");

  await act(() => vi.advanceTimersByTimeAsync(999));
  expect(client.getQr).toHaveBeenCalledTimes(1);
  await act(() => vi.advanceTimersByTimeAsync(1));
  expect(client.getQr).toHaveBeenCalledTimes(2);

  await act(() => vi.advanceTimersByTimeAsync(1_999));
  expect(client.getQr).toHaveBeenCalledTimes(2);
  await act(() => vi.advanceTimersByTimeAsync(1));
  expect(client.getQr).toHaveBeenCalledTimes(3);
});

it("recovers from a stale response and gives the next valid token its remaining lifetime", async () => {
  useStationaryClock();
  const client = createClient();
  const recoveredQr = {
    ...QR,
    token: "recovered-signed-qr",
    issued_at: new Date(NOW.getTime() + 1_000).toISOString(),
    expires_at: new Date(NOW.getTime() + 21_000).toISOString(),
  };
  vi.mocked(client.getQr)
    .mockResolvedValueOnce(EXPIRED_QR)
    .mockResolvedValueOnce(recoveredQr);
  await submitPassword(client);

  await act(() => vi.advanceTimersByTimeAsync(1_000));

  expect(client.getQr).toHaveBeenCalledTimes(2);
  expect(screen.getByRole("img", { name: "학생 출결용 QR 코드" })).toBeInTheDocument();
  expect(screen.getByText("20초 후 갱신")).toBeInTheDocument();
  await act(() => vi.advanceTimersByTimeAsync(19_999));
  expect(client.getQr).toHaveBeenCalledTimes(2);
});

it("rotates HttpOnly cookies on an unauthorized QR response and retries once", async () => {
  const client = createClient();
  vi.mocked(client.getQr)
    .mockRejectedValueOnce(new ApiClientError("KIOSK_SESSION_REVOKED", "expired"))
    .mockResolvedValueOnce(QR);

  await unlock(client);

  expect(client.refresh).toHaveBeenCalledTimes(1);
  expect(client.getQr).toHaveBeenCalledTimes(2);
  expect(screen.getByText("QR 연결됨")).toBeInTheDocument();
});

it("returns to the password form when automatic cookie refresh cannot recover", async () => {
  const client = createClient();
  vi.mocked(client.getQr).mockRejectedValue(
    new ApiClientError("KIOSK_SESSION_REVOKED", "expired"),
  );
  vi.mocked(client.refresh).mockRejectedValue(
    new ApiClientError("KIOSK_SESSION_REVOKED", "revoked"),
  );
  render(<KioskScreen client={client} />);
  fireEvent.change(screen.getByLabelText("관리자 비밀번호"), {
    target: { value: "church-secret" },
  });
  fireEvent.click(screen.getByRole("button", { name: "QR 화면 열기" }));

  await flushAsyncWork();
  expect(screen.getByRole("button", { name: "QR 화면 열기" })).toBeInTheDocument();
  expect(screen.getByRole("status")).toHaveTextContent("기기 세션이 종료되었습니다.");
});

it("resets the device session and clears all scheduled work on unmount", async () => {
  const client = createClient();
  const view = render(<KioskScreen client={client} />);
  fireEvent.change(screen.getByLabelText("관리자 비밀번호"), {
    target: { value: "church-secret" },
  });
  fireEvent.click(screen.getByRole("button", { name: "QR 화면 열기" }));
  await flushAsyncWork();
  expect(screen.getByText("20초 후 갱신")).toBeInTheDocument();

  fireEvent.click(screen.getByRole("button", { name: "관리자 화면 잠금" }));
  await flushAsyncWork();
  expect(screen.getByRole("button", { name: "QR 화면 열기" })).toBeInTheDocument();
  expect(client.logout).toHaveBeenCalledTimes(1);

  view.unmount();
  await act(() => vi.advanceTimersByTimeAsync(60_000));
  expect(client.getQr).toHaveBeenCalledTimes(1);
});

it("refreshes an expired access cookie before revoking the durable device session", async () => {
  const client = createClient();
  vi.mocked(client.logout)
    .mockRejectedValueOnce(new ApiClientError("KIOSK_SESSION_REVOKED", "expired access"))
    .mockResolvedValueOnce(undefined);
  await unlock(client);

  fireEvent.click(screen.getByRole("button", { name: "관리자 화면 잠금" }));

  await flushAsyncWork();
  expect(screen.getByRole("button", { name: "QR 화면 열기" })).toBeInTheDocument();
  expect(client.refresh).toHaveBeenCalledTimes(1);
  expect(client.logout).toHaveBeenCalledTimes(2);
  expect(screen.getByRole("status")).toHaveTextContent("기기 세션을 안전하게 초기화했습니다.");
});

describe("QR rendering", () => {
  it("draws only the signed token into an accessible canvas", async () => {
    const client = createClient();
    await unlock(client);

    expect(screen.getByRole("img", { name: "학생 출결용 QR 코드" })).toBeInTheDocument();
    await flushAsyncWork();
    expect(toCanvas).toHaveBeenCalledWith(
      expect.any(HTMLCanvasElement),
      "signed-attendance-qr",
      expect.objectContaining({ errorCorrectionLevel: "M" }),
    );
    expect(document.body).not.toHaveTextContent("signed-attendance-qr");
  });

  it("keeps the countdown quiet and exposes progress from the same expiry", async () => {
    const client = createClient();
    await unlock(client);

    const countdown = screen.getByText("20초 후 갱신");
    expect(countdown).not.toHaveAttribute("aria-live");
    expect(countdown.closest("[aria-live]")).toBeNull();
    expect(screen.getByRole("progressbar", { name: "QR 코드 유효 시간" }))
      .toHaveAttribute("aria-valuenow", "100");

    await act(() => vi.advanceTimersByTimeAsync(1_000));

    expect(screen.getByText("19초 후 갱신")).toBeInTheDocument();
    expect(screen.getByRole("progressbar", { name: "QR 코드 유효 시간" }))
      .toHaveAttribute("aria-valuenow", "95");
  });

  it("uses ResizeObserver CSS pixels and caps a sharp backing canvas at 2x DPR", async () => {
    vi.stubGlobal("devicePixelRatio", 3);
    const client = createClient();
    await unlock(client);

    resizeQr(447.25);

    const canvas = screen.getByRole("img", { name: "학생 출결용 QR 코드" });
    expect(canvas).toHaveStyle({ width: "447.25px", height: "447.25px" });
    await flushAsyncWork();
    const [renderCanvas, renderToken, renderOptions] = toCanvas.mock.lastCall ?? [];
    expect(renderCanvas).not.toBe(canvas);
    expect(renderCanvas).not.toBeInTheDocument();
    expect(renderToken).toBe("signed-attendance-qr");
    expect(renderOptions).toEqual(expect.objectContaining({ width: 895 }));
    expect(canvas).toHaveProperty("width", 895);
    expect(canvas).toHaveProperty("height", 895);
  });

  it("restores CSS pixel dimensions after the QR renderer writes backing dimensions", async () => {
    vi.stubGlobal("devicePixelRatio", 2);
    toCanvas.mockImplementationOnce(async (
      canvas: HTMLCanvasElement,
      _token: string,
      options?: { width?: number },
    ) => {
      const width = Number(options?.width ?? 0);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${width}px`;
    });
    const client = createClient();
    await unlock(client);

    const canvas = screen.getByRole("img", { name: "학생 출결용 QR 코드" });
    expect(canvas).toHaveStyle({ width: "320px", height: "320px" });
  });

  it("clamps observed QR size between 320 and 520 CSS pixels", async () => {
    const client = createClient();
    await unlock(client);

    resizeQr(280);
    expect(screen.getByRole("img", { name: "학생 출결용 QR 코드" }))
      .toHaveStyle({ width: "320px", height: "320px" });

    resizeQr(610);
    expect(screen.getByRole("img", { name: "학생 출결용 QR 코드" }))
      .toHaveStyle({ width: "520px", height: "520px" });
  });

  it("keeps the newest resized render when an older render resolves last", async () => {
    vi.stubGlobal("devicePixelRatio", 2);
    const renders = useDeferredQrRenderer();
    render(
      <QrCard
        token="resized-token"
        expiresAtMs={NOW.getTime() + 20_000}
        nowMs={NOW.getTime()}
      />,
    );

    resizeQr(447.25);
    expect(renders).toHaveLength(2);
    await act(async () => renders[1].resolve());

    const canvas = screen.getByRole("img", { name: "학생 출결용 QR 코드" });
    expect(canvas).toHaveProperty("width", 895);
    expect(canvas).toHaveStyle({ width: "447.25px", height: "447.25px" });
    expect(canvas).toHaveAttribute("data-pixel-marker", "resized-token");

    await act(async () => renders[0].resolve());

    expect(canvas).toHaveProperty("width", 895);
    expect(canvas).toHaveStyle({ width: "447.25px", height: "447.25px" });
    expect(canvas).toHaveAttribute("data-pixel-marker", "resized-token");
  });

  it("keeps the newest token pixels when an older token render resolves last", async () => {
    const renders = useDeferredQrRenderer();
    const view = render(
      <QrCard
        token="old-token"
        expiresAtMs={NOW.getTime() + 20_000}
        nowMs={NOW.getTime()}
      />,
    );
    view.rerender(
      <QrCard
        token="new-token"
        expiresAtMs={NOW.getTime() + 20_000}
        nowMs={NOW.getTime()}
      />,
    );

    expect(renders).toHaveLength(2);
    await act(async () => renders[1].resolve());
    const canvas = screen.getByRole("img", { name: "학생 출결용 QR 코드" });
    expect(canvas).toHaveAttribute("data-pixel-marker", "new-token");

    await act(async () => renders[0].resolve());
    expect(canvas).toHaveAttribute("data-pixel-marker", "new-token");
  });

  it("does not commit a detached render after the QR card unmounts", async () => {
    const renders = useDeferredQrRenderer();
    const view = render(
      <QrCard
        token="unmounted-token"
        expiresAtMs={NOW.getTime() + 20_000}
        nowMs={NOW.getTime()}
      />,
    );
    const canvas = screen.getByRole("img", { name: "학생 출결용 QR 코드" });

    view.unmount();
    await act(async () => renders[0].resolve());

    expect(canvas).not.toHaveAttribute("data-pixel-marker");
  });
});
