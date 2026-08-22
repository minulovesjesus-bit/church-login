"use client";

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";

import { ProtectedStaffLayout } from "@/components/layout/protected-staff-layout";

export default function TeacherLayout({ children }: Readonly<{ children: ReactNode }>) {
  const pathname = usePathname();
  if (pathname === "/teacher/login" || pathname === "/teacher/apply") return children;
  return <ProtectedStaffLayout>{children}</ProtectedStaffLayout>;
}
