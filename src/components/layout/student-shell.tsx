import type { ReactNode } from "react";

import { StudentNavigation } from "@/components/navigation/student-navigation";
import { StudentSessionGuard } from "@/components/layout/student-session-guard";

export function StudentShell({ children }: { children: ReactNode }) {
  return (
    <StudentSessionGuard>
      <div className="student-shell min-h-dvh bg-background text-foreground">
        <StudentNavigation />
        <div className="student-shell-content">{children}</div>
      </div>
    </StudentSessionGuard>
  );
}
