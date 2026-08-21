import { expect, it, vi } from "vitest";

import { ATTENDANCE_TEST_QR_EVENT, testQrDecoder } from "./test-qr-decoder";

it("passes a test QR through the decoder boundary and stops listening on cleanup", async () => {
  const decoded = vi.fn();
  const stop = await testQrDecoder.start(document.createElement("video"), decoded);

  window.dispatchEvent(new CustomEvent(ATTENDANCE_TEST_QR_EVENT, { detail: " signed-qr " }));
  expect(decoded).toHaveBeenCalledWith(" signed-qr ");

  stop();
  window.dispatchEvent(new CustomEvent(ATTENDANCE_TEST_QR_EVENT, { detail: "second" }));
  expect(decoded).toHaveBeenCalledTimes(1);
});

it("ignores malformed fixture events", async () => {
  const decoded = vi.fn();
  const stop = await testQrDecoder.start(document.createElement("video"), decoded);

  window.dispatchEvent(new CustomEvent(ATTENDANCE_TEST_QR_EVENT, { detail: { token: "no" } }));
  window.dispatchEvent(new CustomEvent(ATTENDANCE_TEST_QR_EVENT, { detail: "" }));

  expect(decoded).not.toHaveBeenCalled();
  stop();
});
