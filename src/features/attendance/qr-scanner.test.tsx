import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiClientError } from "@/lib/api/client";

import {
  QrScanner,
  type AttendanceScanClient,
  type QrDecoder,
} from "./qr-scanner";

const REQUEST_ID = "e1d4ff47-835e-4a60-b39b-f2a8a182d197";
const ACCEPTED_IN = {
  scan_id: "0c6b0430-6959-46ce-a40f-0698c13f5346",
  direction: "IN" as const,
  scanned_at: "2026-08-21T01:00:00Z",
  duplicate: false,
  cooldown_remaining: null,
};

function createScanClient(): AttendanceScanClient {
  return { scan: vi.fn().mockResolvedValue(ACCEPTED_IN) };
}

function createDecoder() {
  let decoded: ((value: string) => void) | undefined;
  const stop = vi.fn();
  const decoder: QrDecoder = {
    start: vi.fn(async (video, onDecoded) => {
      decoded = onDecoded;
      Object.defineProperty(video, "srcObject", {
        configurable: true,
        writable: true,
        value: { getTracks: () => [{ stop }] },
      });
      return stop;
    }),
  };
  return {
    decoder,
    stop,
    decode(value: string) {
      if (!decoded) throw new Error("decoder not started");
      decoded(value);
    },
  };
}

async function readyScanner(
  client = createScanClient(),
  camera = createDecoder(),
) {
  render(
    <QrScanner
      client={client}
      createRequestId={() => REQUEST_ID}
      decoder={camera.decoder}
    />,
  );
  expect(await screen.findByText("QR 코드를 화면 안에 맞춰 주세요")).toBeInTheDocument();
  return { client, camera };
}

afterEach(() => {
  vi.restoreAllMocks();
});

it("submits one request for repeated decode callbacks and pauses the camera", async () => {
  let accept: ((value: typeof ACCEPTED_IN) => void) | undefined;
  const client = createScanClient();
  vi.mocked(client.scan).mockImplementation(() => new Promise((resolve) => {
    accept = resolve;
  }));
  const { camera } = await readyScanner(client);

  act(() => {
    camera.decode("signed-qr");
    camera.decode("signed-qr");
  });

  expect(await screen.findByText("출결을 전송하고 있어요")).toBeInTheDocument();
  expect(client.scan).toHaveBeenCalledTimes(1);
  expect(client.scan).toHaveBeenCalledWith({
    qr_token: "signed-qr",
    request_id: REQUEST_ID,
  });
  expect(camera.stop).toHaveBeenCalled();

  await act(async () => accept?.(ACCEPTED_IN));
  expect(await screen.findByRole("heading", { name: "입실 처리됐어요" })).toBeInTheDocument();
});

it("reuses the same request id and decoded value for a network retry", async () => {
  const client = createScanClient();
  vi.mocked(client.scan)
    .mockRejectedValueOnce(new TypeError("offline"))
    .mockResolvedValueOnce(ACCEPTED_IN);
  const { camera } = await readyScanner(client);
  act(() => camera.decode("signed-qr"));

  fireEvent.click(await screen.findByRole("button", { name: "같은 출결 다시 전송" }));

  await waitFor(() => expect(client.scan).toHaveBeenCalledTimes(2));
  expect(client.scan).toHaveBeenNthCalledWith(1, {
    qr_token: "signed-qr",
    request_id: REQUEST_ID,
  });
  expect(client.scan).toHaveBeenNthCalledWith(2, {
    qr_token: "signed-qr",
    request_id: REQUEST_ID,
  });
  expect(await screen.findByRole("heading", { name: "입실 처리됐어요" })).toBeInTheDocument();
});

it("shows duplicate success without changing the accepted direction", async () => {
  const client = createScanClient();
  vi.mocked(client.scan).mockResolvedValue({ ...ACCEPTED_IN, direction: "OUT", duplicate: true });
  const { camera } = await readyScanner(client);
  act(() => camera.decode("signed-qr"));

  expect(await screen.findByRole("heading", { name: "퇴실 처리됐어요" })).toBeInTheDocument();
  expect(screen.getByText("이미 처리된 요청의 결과예요.")).toBeInTheDocument();
});

it("shows cooldown as information and offers a fresh scan", async () => {
  const client = createScanClient();
  vi.mocked(client.scan).mockResolvedValue({
    ...ACCEPTED_IN,
    cooldown_remaining: 4.2,
  });
  const { camera } = await readyScanner(client);
  act(() => camera.decode("signed-qr"));

  expect(await screen.findByRole("heading", { name: "잠시만 기다려 주세요" })).toBeInTheDocument();
  expect(screen.getByText("5초 후 다시 스캔할 수 있어요.")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "새 QR 스캔" })).toBeInTheDocument();
});

describe.each([
  ["QR_INVALID", "유효하지 않은 QR 코드예요."],
  ["QR_EXPIRED", "QR 코드가 만료됐어요."],
  ["KIOSK_SESSION_REVOKED", "이 기기의 QR 사용이 중지됐어요."],
  ["RATE_LIMITED", "요청이 너무 많아요. 잠시 후 다시 시도해 주세요."],
  ["AUTH_REQUIRED", "학생 로그인이 필요해요."],
] as const)("%s scan error", (code, message) => {
  it("shows a safe Korean recovery state", async () => {
    const client = createScanClient();
    vi.mocked(client.scan).mockRejectedValue(new ApiClientError(code, "unsafe server detail"));
    const { camera } = await readyScanner(client);
    act(() => camera.decode("signed-qr"));

    expect(await screen.findByRole("alert")).toHaveTextContent(message);
    expect(screen.queryByText("unsafe server detail")).not.toBeInTheDocument();
  });
});

it("distinguishes camera permission denial from an unsupported camera", async () => {
  const denied = createDecoder();
  vi.mocked(denied.decoder.start).mockRejectedValue(
    new DOMException("denied", "NotAllowedError"),
  );
  const first = render(
    <QrScanner client={createScanClient()} decoder={denied.decoder} />,
  );
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "카메라 권한을 허용해 주세요.",
  );
  first.unmount();

  const missing = createDecoder();
  vi.mocked(missing.decoder.start).mockRejectedValue(
    new DOMException("missing", "NotFoundError"),
  );
  render(<QrScanner client={createScanClient()} decoder={missing.decoder} />);
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "사용할 수 있는 카메라를 찾지 못했어요.",
  );
});

it("stops partially opened camera tracks when decoder startup fails", async () => {
  const stopTrack = vi.fn();
  const decoder: QrDecoder = {
    start: vi.fn(async (video) => {
      Object.defineProperty(video, "srcObject", {
        configurable: true,
        writable: true,
        value: { getTracks: () => [{ stop: stopTrack }] },
      });
      throw new DOMException("camera failed", "AbortError");
    }),
  };

  render(<QrScanner client={createScanClient()} decoder={decoder} />);

  expect(await screen.findByRole("alert")).toBeInTheDocument();
  expect(stopTrack).toHaveBeenCalledTimes(1);
});

it("stops decoder controls and every media track on unmount", async () => {
  const camera = createDecoder();
  const view = render(
    <QrScanner client={createScanClient()} decoder={camera.decoder} />,
  );
  expect(await screen.findByText("QR 코드를 화면 안에 맞춰 주세요")).toBeInTheDocument();

  view.unmount();

  expect(camera.stop).toHaveBeenCalledTimes(2);
});

it("cleans up a decoder that finishes starting after unmount without a stale render", async () => {
  let finishStart: ((stop: () => void) => void) | undefined;
  const stop = vi.fn();
  const decoder: QrDecoder = {
    start: vi.fn(() => new Promise<() => void>((resolve) => {
      finishStart = resolve;
    })),
  };
  const view = render(<QrScanner client={createScanClient()} decoder={decoder} />);
  view.unmount();

  await act(async () => finishStart?.(stop));

  expect(stop).toHaveBeenCalledTimes(1);
});
