import type { QrDecoder } from "./qr-scanner";

let activeDecoderSessions = 0;

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
    activeDecoderSessions += 1;
    let released = false;

    const releaseTrackedSession = () => {
      if (released) return;
      released = true;
      activeDecoderSessions = Math.max(0, activeDecoderSessions - 1);
      if (activeDecoderSessions === 0) BrowserQRCodeReader.releaseAllStreams();
    };

    try {
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
        if (released) return;
        try {
          controls.stop();
        } finally {
          try {
            stopVideoTracks(video);
          } finally {
            releaseTrackedSession();
          }
        }
      };
    } catch (error) {
      try {
        stopVideoTracks(video);
      } finally {
        releaseTrackedSession();
      }
      throw error;
    }
  },
};
