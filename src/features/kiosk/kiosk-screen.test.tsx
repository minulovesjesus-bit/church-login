import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiClientError } from "@/lib/api/client";

const toCanvas = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
vi.mock("qrcode", () => ({ default: { toCanvas } }));

import { KioskScreen, type KioskClient } from "./kiosk-screen";

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
  expect(await screen.findByText("20초 후 갱신")).toBeInTheDocument();
}

async function submitPassword(client: KioskClient) {
  render(<KioskScreen client={client} />);
  fireEvent.change(screen.getByLabelText("관리자 비밀번호"), {
    target: { value: "church-secret" },
  });
  fireEvent.click(screen.getByRole("button", { name: "QR 화면 열기" }));
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

function useStationaryClock() {
  vi.useRealTimers();
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(NOW);
  toCanvas.mockClear();
});

afterEach(() => {
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

  expect(await screen.findByRole("alert")).toHaveTextContent(
    "관리자 비밀번호를 확인해 주세요.",
  );
  expect(screen.queryByText("server detail must not be echoed")).not.toBeInTheDocument();
});

it("keeps one QR for the full server lifetime and schedules the next request at expiry", async () => {
  const client = createClient();
  await unlock(client);

  expect(client.getQr).toHaveBeenCalledTimes(1);
  const untilExpiry = Date.parse(QR.expires_at) - Date.now();
  await act(() => vi.advanceTimersByTimeAsync(untilExpiry - 1));
  expect(client.getQr).toHaveBeenCalledTimes(1);

  await act(() => vi.advanceTimersByTimeAsync(1));
  expect(client.getQr).toHaveBeenCalledTimes(2);
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
  expect(await screen.findByText("연결을 다시 시도하고 있어요")).toBeInTheDocument();
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
  expect(await screen.findByText("QR 연결됨")).toBeInTheDocument();
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
  expect(screen.getByRole("status")).toHaveTextContent("QR을 준비하고 있어요");
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

  expect(await screen.findByRole("button", { name: "QR 화면 열기" })).toBeInTheDocument();
  expect(screen.getByRole("status")).toHaveTextContent("기기 세션이 종료되었습니다.");
});

it("resets the device session and clears all scheduled work on unmount", async () => {
  const client = createClient();
  const view = render(<KioskScreen client={client} />);
  fireEvent.change(screen.getByLabelText("관리자 비밀번호"), {
    target: { value: "church-secret" },
  });
  fireEvent.click(screen.getByRole("button", { name: "QR 화면 열기" }));
  expect(await screen.findByText("20초 후 갱신")).toBeInTheDocument();

  fireEvent.click(screen.getByRole("button", { name: "기기 세션 초기화" }));
  expect(await screen.findByRole("button", { name: "QR 화면 열기" })).toBeInTheDocument();
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

  fireEvent.click(screen.getByRole("button", { name: "기기 세션 초기화" }));

  expect(await screen.findByRole("button", { name: "QR 화면 열기" })).toBeInTheDocument();
  expect(client.refresh).toHaveBeenCalledTimes(1);
  expect(client.logout).toHaveBeenCalledTimes(2);
  expect(screen.getByRole("status")).toHaveTextContent("기기 세션을 안전하게 초기화했습니다.");
});

describe("QR rendering", () => {
  it("draws only the signed token into an accessible canvas", async () => {
    const client = createClient();
    await unlock(client);

    expect(screen.getByRole("img", { name: "학생 출결용 QR 코드" })).toBeInTheDocument();
    expect(toCanvas).toHaveBeenCalledWith(
      expect.any(HTMLCanvasElement),
      "signed-attendance-qr",
      expect.objectContaining({ errorCorrectionLevel: "M" }),
    );
    expect(document.body).not.toHaveTextContent("signed-attendance-qr");
  });
});
