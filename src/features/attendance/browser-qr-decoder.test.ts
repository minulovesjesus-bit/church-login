import { beforeEach, expect, it, vi } from "vitest";

const zxing = vi.hoisted(() => ({
  decodeFromConstraints: vi.fn(),
  releaseAllStreams: vi.fn(),
}));

vi.mock("@zxing/browser", () => {
  class BrowserQRCodeReader {
    static releaseAllStreams = zxing.releaseAllStreams;

    decodeFromConstraints(
      constraints: MediaStreamConstraints,
      video: HTMLVideoElement,
      onDecoded: (result?: { getText(): string }) => void,
    ) {
      return zxing.decodeFromConstraints(constraints, video, onDecoded);
    }
  }
  return { BrowserQRCodeReader };
});

import { browserQrDecoder } from "./browser-qr-decoder";

function videoWithTrack(stop = vi.fn()) {
  const video = document.createElement("video");
  Object.defineProperty(video, "srcObject", {
    configurable: true,
    writable: true,
    value: { getTracks: () => [{ stop }] },
  });
  return { video, stop };
}

beforeEach(() => {
  zxing.decodeFromConstraints.mockReset();
  zxing.releaseAllStreams.mockReset();
});

it("stops controls and tracks and releases ZXing's retained stream references", async () => {
  const controlsStop = vi.fn();
  const camera = videoWithTrack();
  zxing.decodeFromConstraints.mockResolvedValue({ stop: controlsStop });

  const cleanup = await browserQrDecoder.start(camera.video, vi.fn());
  cleanup();
  cleanup();

  expect(controlsStop).toHaveBeenCalledTimes(1);
  expect(camera.stop).toHaveBeenCalled();
  expect(zxing.releaseAllStreams).toHaveBeenCalledTimes(1);
});

it("releases a partially tracked stream when ZXing startup fails", async () => {
  const camera = videoWithTrack();
  zxing.decodeFromConstraints.mockRejectedValue(new DOMException("failed", "AbortError"));

  await expect(browserQrDecoder.start(camera.video, vi.fn())).rejects.toThrow("failed");

  expect(camera.stop).toHaveBeenCalled();
  expect(zxing.releaseAllStreams).toHaveBeenCalledTimes(1);
});

it("does not release global ZXing streams while another scanner is active", async () => {
  const firstControls = { stop: vi.fn() };
  const secondControls = { stop: vi.fn() };
  zxing.decodeFromConstraints
    .mockResolvedValueOnce(firstControls)
    .mockResolvedValueOnce(secondControls);
  const first = videoWithTrack();
  const second = videoWithTrack();

  const cleanupFirst = await browserQrDecoder.start(first.video, vi.fn());
  const cleanupSecond = await browserQrDecoder.start(second.video, vi.fn());
  cleanupFirst();

  expect(firstControls.stop).toHaveBeenCalledTimes(1);
  expect(secondControls.stop).not.toHaveBeenCalled();
  expect(zxing.releaseAllStreams).not.toHaveBeenCalled();

  cleanupSecond();
  expect(zxing.releaseAllStreams).toHaveBeenCalledTimes(1);
});
