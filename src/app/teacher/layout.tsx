"use client";

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";

import { ProtectedStaffLayout } from "@/components/layout/protected-staff-layout";

const COMPATIBILITY_PATHS = new Set(["/teacher/login", "/teacher/apply", "/teacher/applications"]);

export default function TeacherLayout({ children }: Readonly<{ children: ReactNode }>) {
  const pathname = usePathname();
  if (COMPATIBILITY_PATHS.has(pathname)) return children;
  return <ProtectedStaffLayout>{children}</ProtectedStaffLayout>;
}
