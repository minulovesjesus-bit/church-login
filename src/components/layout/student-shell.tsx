import type { ReactNode } from "react";

import { StudentNavigation } from "@/components/navigation/student-navigation";

export function StudentShell({ children }: { children: ReactNode }) {
  return (
    <div className="student-shell min-h-dvh bg-background text-foreground">
      <StudentNavigation />
      <div className="student-shell-content">{children}</div>
    </div>
  );
}
