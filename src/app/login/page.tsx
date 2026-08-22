import type { Metadata } from "next";

import { KioskScreen } from "@/features/kiosk/kiosk-screen";

export const metadata: Metadata = {
  title: "출결 QR 기기 | 교회 출결",
};

export default function KioskLoginPage() {
  return <KioskScreen />;
}
