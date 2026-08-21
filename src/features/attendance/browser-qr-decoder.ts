import type { QrDecoder } from "./qr-scanner";

function stopVideoTracks(video: HTMLVideoElement): void {
  const stream = video.srcObject;
  if (stream && "getTracks" in stream) {
    stream.getTracks().forEach((track) => track.stop());
  }
  video.srcObject = null;
}

export const browserQrDecoder: QrDecoder = {
  async start(video, onDecoded) {
    const { BrowserQRCodeReader } = await import("@zxing/browser");
    const reader = new BrowserQRCodeReader(undefined, {
      delayBetweenScanAttempts: 150,
      delayBetweenScanSuccess: 500,
    });
    const controls = await reader.decodeFromConstraints(
      {
        audio: false,
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
      },
      video,
      (result) => {
        const value = result?.getText().trim();
        if (value) onDecoded(value);
      },
    );

    return () => {
      controls.stop();
      stopVideoTracks(video);
    };
  },
};
