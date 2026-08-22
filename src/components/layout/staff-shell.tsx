"use client";

import type { ReactNode } from "react";

import { TeacherNavigation } from "@/components/navigation/teacher-navigation";
import { SidebarProvider } from "@/components/ui/sidebar";

export type StaffShellProps = {
  children: ReactNode;
  admin: boolean;
};

export function StaffShell({ children, admin }: StaffShellProps) {
  return (
    <SidebarProvider open enableKeyboardShortcut={false} onOpenChange={() => undefined}>
      <div className="staff-shell">
        <TeacherNavigation admin={admin} />
        <div className="staff-shell__content">{children}</div>
      </div>
    </SidebarProvider>
  );
}
