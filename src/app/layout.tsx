import type { Metadata } from "next";
import { Noto_Sans_KR } from "next/font/google";
import type { ReactNode } from "react";

import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";

import "./globals.css";

const notoSansKr = Noto_Sans_KR({
  subsets: ["latin"],
  variable: "--font-sans",
});

export const metadata: Metadata = {
  title: "교회 출결",
  description: "교회 출결 관리 시스템",
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="ko" className={notoSansKr.variable}>
      <body>
        <TooltipProvider>{children}</TooltipProvider>
        <Toaster />
      </body>
    </html>
  );
}
