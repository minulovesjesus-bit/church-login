import type { ReactNode } from "react";

import { BrandLockup } from "@/components/brand/brand-mark";
import { StudentNavigation } from "@/components/navigation/student-navigation";
import { StudentSessionGuard } from "@/components/layout/student-session-guard";

export function StudentShell({ children }: { children: ReactNode }) {
  return (
    <StudentSessionGuard>
      <div className="student-shell min-h-dvh bg-background text-foreground">
        <StudentNavigation />
        <header className="student-brand-header" aria-label="갈보리교회">
          <BrandLockup />
        </header>
        <div className="student-shell-content">{children}</div>
      </div>
    </StudentSessionGuard>
  );
}
