import type { ReactNode } from "react";

import { BrandLockup } from "@/components/brand/brand-mark";
import { cn } from "@/lib/utils";

type KioskShellProps = {
  children: ReactNode;
  mode: "locked" | "unlocked";
  toolbar?: ReactNode;
};

export function KioskShell({ children, mode, toolbar }: KioskShellProps) {
  return (
    <main className={cn("kiosk-shell", mode === "unlocked" && "kiosk-shell--unlocked")}>
      {mode === "unlocked" ? (
        <header className="kiosk-header">
          <BrandLockup />
          <div className="kiosk-toolbar">{toolbar}</div>
        </header>
      ) : null}
      <div className="kiosk-shell__content">{children}</div>
    </main>
  );
}
