"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { CalendarDays, ClipboardList, GraduationCap, Home, ScanLine } from "lucide-react";

import { api } from "@/lib/api/client";

const LINKS = [
  { href: "/student", label: "홈", icon: Home },
  { href: "/student/scan", label: "QR 출결", icon: ScanLine },
  { href: "/student/attendance", label: "출결 기록", icon: ClipboardList },
  { href: "/student/events", label: "일정", icon: CalendarDays },
] as const;

type CurrentIdentity = {
  capabilities: { teacher: boolean; admin: boolean };
};

function isCurrent(pathname: string, href: string): boolean {
  return href === "/student" ? pathname === href : pathname.startsWith(href);
}

export function StudentNavigation() {
  const pathname = usePathname();
  const [staffMode, setStaffMode] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;

    api.get<CurrentIdentity>("/api/me", { signal: controller.signal })
      .then((identity) => {
        if (active) setStaffMode(identity.capabilities.teacher || identity.capabilities.admin);
      })
      .catch(() => undefined);

    return () => {
      active = false;
      controller.abort();
    };
  }, []);

  const links = staffMode
    ? [...LINKS, { href: "/teacher", label: "교사 모드", icon: GraduationCap } as const]
    : LINKS;

  return (
    <nav className="student-navigation" aria-label="학생 메뉴" data-items={links.length}>
      <ul>
        {links.map(({ href, icon: Icon, label }) => (
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
