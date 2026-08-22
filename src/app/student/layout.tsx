import type { ReactNode } from "react";

import { StudentShell } from "@/components/layout/student-shell";

export default function StudentLayout({ children }: Readonly<{ children: ReactNode }>) {
  return <StudentShell>{children}</StudentShell>;
}
