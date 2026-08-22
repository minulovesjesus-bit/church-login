"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { CalendarDays, ClipboardList, Home, ScanLine } from "lucide-react";

const LINKS = [
  { href: "/student", label: "홈", icon: Home },
  { href: "/student/scan", label: "QR 출결", icon: ScanLine },
  { href: "/student/attendance", label: "출결 기록", icon: ClipboardList },
  { href: "/student/events", label: "일정", icon: CalendarDays },
] as const;

function isCurrent(pathname: string, href: string): boolean {
  return href === "/student" ? pathname === href : pathname.startsWith(href);
}

export function StudentNavigation() {
  const pathname = usePathname();
  return (
    <nav className="student-navigation" aria-label="학생 메뉴">
      <ul>
        {LINKS.map(({ href, icon: Icon, label }) => (
          <li key={href}>
            <Link href={href} aria-current={isCurrent(pathname, href) ? "page" : undefined}>
              <Icon aria-hidden="true" />
              <span>{label}</span>
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
