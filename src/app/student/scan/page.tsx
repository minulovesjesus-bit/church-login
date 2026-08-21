"use client";

import dynamic from "next/dynamic";

const QrScanner = dynamic(
  () => import("@/features/attendance/qr-scanner").then((module) => module.QrScanner),
  {
    ssr: false,
    loading: () => <p role="status">QR 스캐너를 준비하고 있어요.</p>,
  },
);

export default function StudentScanPage() {
  return (
    <main className="student-scan-shell">
      <QrScanner />
    </main>
  );
}
