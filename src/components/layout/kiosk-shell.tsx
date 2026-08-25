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
      <div className="kiosk-shell__content">{children}</div>
      {mode === "unlocked" ? (
        <footer className="kiosk-footer">
          <div className="kiosk-toolbar">{toolbar}</div>
          <BrandLockup />
        </footer>
      ) : null}
    </main>
  );
}
