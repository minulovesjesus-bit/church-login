"use client";

import dynamic from "next/dynamic";

import { testQrDecoder } from "@/features/attendance/test-qr-decoder";

const QrScanner = dynamic(
  () => import("@/features/attendance/qr-scanner").then((module) => module.QrScanner),
  {
    ssr: false,
    loading: () => <p role="status">QR 스캐너를 준비하고 있어요.</p>,
  },
);

export function StudentScanClient({ testFixtureEnabled }: { testFixtureEnabled: boolean }) {
  return <QrScanner decoder={testFixtureEnabled ? testQrDecoder : undefined} />;
}
