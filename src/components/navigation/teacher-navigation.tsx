"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

const CORE_LINKS = [
  { href: "/teacher", label: "대시보드" },
  { href: "/teacher/attendance", label: "출결 관리" },
  { href: "/teacher/students", label: "학생 관리" },
  { href: "/teacher/events", label: "일정 관리" },
] as const;

const ADMIN_LINKS = [
  { href: "/teacher/applications", label: "교사 신청" },
  { href: "/admin/staff", label: "교사 권한" },
  { href: "/admin/kiosks", label: "키오스크" },
] as const;

function isCurrent(pathname: string, href: string): boolean {
  return href === "/teacher" ? pathname === href : pathname.startsWith(href);
}

export function TeacherNavigation({ admin }: { admin: boolean }) {
  const pathname = usePathname();
  const [openPathname, setOpenPathname] = useState<string>();
  const open = openPathname === pathname;

  useEffect(() => {
    if (!open) return undefined;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpenPathname(undefined);
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [open]);

  const links = admin ? [...CORE_LINKS, ...ADMIN_LINKS] : CORE_LINKS;
  return (
    <>
      <header className="teacher-mobile-header">
        <strong>교회 출결</strong>
        <button
          type="button"
          className="teacher-menu-button"
          aria-label="교사 메뉴 열기"
          aria-expanded={open}
          aria-controls="teacher-navigation"
          onClick={() => setOpenPathname(pathname)}
        >
          메뉴
        </button>
      </header>
      {open ? <button type="button" className="teacher-nav-backdrop" aria-label="교사 메뉴 닫기" onClick={() => setOpenPathname(undefined)} /> : null}
      <aside id="teacher-navigation" className={`teacher-sidebar${open ? " teacher-sidebar--open" : ""}`}>
        <div className="teacher-sidebar__brand">
          <p>Church attendance</p>
          <strong>교회 출결</strong>
          <button type="button" className="teacher-nav-close" aria-label="교사 메뉴 닫기" onClick={() => setOpenPathname(undefined)}>닫기</button>
        </div>
        <nav aria-label="교사 메뉴">
          <ul>
            {links.map((link) => (
              <li key={link.href}>
                <Link href={link.href} aria-current={isCurrent(pathname, link.href) ? "page" : undefined}>{link.label}</Link>
              </li>
            ))}
          </ul>
        </nav>
      </aside>
    </>
  );
}
