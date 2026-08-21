import type { QrDecoder } from "./qr-scanner";

export const ATTENDANCE_TEST_QR_EVENT = "attendance:test-qr";

export const testQrDecoder: QrDecoder = {
  async start(_video, onDecoded) {
    const listener = (event: Event) => {
      if (!(event instanceof CustomEvent) || typeof event.detail !== "string" || !event.detail.trim()) return;
      onDecoded(event.detail);
    };
    window.addEventListener(ATTENDANCE_TEST_QR_EVENT, listener);
    return () => window.removeEventListener(ATTENDANCE_TEST_QR_EVENT, listener);
  },
};
