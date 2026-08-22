import type { ReactNode } from "react";

import { ProtectedStaffLayout } from "@/components/layout/protected-staff-layout";

export default function AdminLayout({ children }: Readonly<{ children: ReactNode }>) {
  return <ProtectedStaffLayout requireAdmin>{children}</ProtectedStaffLayout>;
}
