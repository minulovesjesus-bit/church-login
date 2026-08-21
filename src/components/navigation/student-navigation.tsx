"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/student", label: "홈" },
  { href: "/student/scan", label: "QR 출결" },
  { href: "/student/attendance", label: "출결 기록" },
  { href: "/student/events", label: "일정" },
] as const;

function isCurrent(pathname: string, href: string): boolean {
  return href === "/student" ? pathname === href : pathname.startsWith(href);
}

export function StudentNavigation() {
  const pathname = usePathname();
  return (
    <nav className="student-navigation" aria-label="학생 메뉴">
      <ul>
        {LINKS.map((link) => (
          <li key={link.href}>
            <Link href={link.href} aria-current={isCurrent(pathname, link.href) ? "page" : undefined}>
              {link.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
