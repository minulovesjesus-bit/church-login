"use client";

import dynamic from "next/dynamic";

import { Spinner } from "@/components/ui/spinner";
import { testQrDecoder } from "@/features/attendance/test-qr-decoder";

const QrScanner = dynamic(
  () => import("@/features/attendance/qr-scanner").then((module) => module.QrScanner),
  {
    ssr: false,
    loading: () => (
      <div className="student-scan-loading" role="status">
        <Spinner aria-hidden="true" />
        <p>QR 스캐너를 준비하고 있어요.</p>
      </div>
    ),
  },
);

export function StudentScanClient({ testFixtureEnabled }: { testFixtureEnabled: boolean }) {
  return <QrScanner decoder={testFixtureEnabled ? testQrDecoder : undefined} />;
}
