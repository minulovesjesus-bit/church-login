"use client";

import { useEffect, useState, type ComponentType } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  CalendarDaysIcon,
  ClipboardCheckIcon,
  LayoutDashboardIcon,
  MenuIcon,
  MonitorSmartphoneIcon,
  ShieldCheckIcon,
  UserRoundPlusIcon,
  UsersRoundIcon,
  XIcon,
} from "lucide-react";

import { BrandMark } from "@/components/brand/brand-mark";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarSeparator,
} from "@/components/ui/sidebar";
import { useIsMobile } from "@/hooks/use-mobile";
import { DESKTOP_MEDIA_QUERY } from "@/lib/responsive";

type NavigationLink = {
  href: string;
  label: string;
  icon: ComponentType;
};

const CORE_LINKS: NavigationLink[] = [
  { href: "/teacher", label: "대시보드", icon: LayoutDashboardIcon },
  { href: "/teacher/attendance", label: "출결 관리", icon: ClipboardCheckIcon },
  { href: "/teacher/students", label: "학생 관리", icon: UsersRoundIcon },
  { href: "/teacher/events", label: "일정 관리", icon: CalendarDaysIcon },
];

const ADMIN_LINKS: NavigationLink[] = [
  { href: "/teacher/applications", label: "교사 신청", icon: UserRoundPlusIcon },
  { href: "/admin/staff", label: "교사 권한", icon: ShieldCheckIcon },
  { href: "/admin/kiosks", label: "키오스크", icon: MonitorSmartphoneIcon },
];

function isCurrent(pathname: string, href: string): boolean {
  return href === "/teacher" ? pathname === href : pathname.startsWith(href);
}

function NavigationItems({ links, pathname, onNavigate }: {
  links: NavigationLink[];
  pathname: string;
  onNavigate: () => void;
}) {
  return (
    <SidebarMenu>
      {links.map((link) => {
        const Icon = link.icon;
        return (
          <SidebarMenuItem key={link.href}>
            <SidebarMenuButton asChild isActive={isCurrent(pathname, link.href)}>
              <Link
                href={link.href}
                aria-current={isCurrent(pathname, link.href) ? "page" : undefined}
                onClick={onNavigate}
              >
                <Icon />
                <span>{link.label}</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        );
      })}
    </SidebarMenu>
  );
}

function NavigationPanel({ admin, pathname, onNavigate, id }: {
  admin: boolean;
  pathname: string;
  onNavigate: () => void;
  id?: string;
}) {
  return (
    <>
      <SidebarHeader>
        <div className="staff-sidebar-brand">
          <BrandMark className="size-10" />
          <strong>교회 출결</strong>
        </div>
      </SidebarHeader>
      <SidebarContent>
        <nav id={id} aria-label="교사 메뉴">
          <SidebarGroup>
            <SidebarGroupContent>
              <NavigationItems links={CORE_LINKS} pathname={pathname} onNavigate={onNavigate} />
            </SidebarGroupContent>
          </SidebarGroup>
          {admin ? (
            <>
              <SidebarSeparator />
              <SidebarGroup>
                <SidebarGroupLabel>관리자</SidebarGroupLabel>
                <SidebarGroupContent>
                  <NavigationItems links={ADMIN_LINKS} pathname={pathname} onNavigate={onNavigate} />
                </SidebarGroupContent>
              </SidebarGroup>
            </>
          ) : null}
        </nav>
      </SidebarContent>
    </>
  );
}

export function TeacherNavigation({ admin }: { admin: boolean }) {
  const pathname = usePathname();
  const isMobile = useIsMobile();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const closeTimer = window.setTimeout(() => setOpen(false), 0);
    return () => window.clearTimeout(closeTimer);
  }, [pathname]);

  useEffect(() => {
    const desktopQuery = window.matchMedia?.(DESKTOP_MEDIA_QUERY);
    if (!desktopQuery) return undefined;
    const closeAtDesktop = (event: MediaQueryListEvent) => {
      if (event.matches) setOpen(false);
    };
    desktopQuery.addEventListener("change", closeAtDesktop);
    return () => desktopQuery.removeEventListener("change", closeAtDesktop);
  }, []);

  return (
    <>
      <div className="staff-navigation-desktop" aria-hidden={isMobile || open || undefined}>
        <Sidebar collapsible="none">
          <NavigationPanel admin={admin} pathname={pathname} onNavigate={() => setOpen(false)} id="teacher-navigation-desktop" />
        </Sidebar>
      </div>

      <Sheet open={open} onOpenChange={setOpen}>
        <nav
          className="staff-mobile-header"
          aria-label="교사 메뉴"
          aria-hidden={!isMobile || open || undefined}
        >
          <div className="staff-mobile-header__brand">
            <BrandMark className="size-9" />
            <strong>교회 출결</strong>
          </div>
          <SheetTrigger asChild>
            <Button
              type="button"
              variant="outline"
              size="icon"
              aria-label="교사 메뉴 열기"
              aria-expanded={open}
              aria-controls="teacher-navigation"
            >
              <MenuIcon data-icon="inline-start" />
            </Button>
          </SheetTrigger>
        </nav>
        <SheetContent id="teacher-navigation" className="staff-mobile-sheet" side="left" showCloseButton={false}>
          <SheetHeader className="staff-mobile-sheet__header">
            <div>
              <SheetTitle>교사 메뉴</SheetTitle>
              <SheetDescription className="sr-only">교사 및 관리자 페이지 이동 메뉴</SheetDescription>
            </div>
            <SheetClose asChild>
              <Button type="button" variant="ghost" size="icon" aria-label="교사 메뉴 닫기">
                <XIcon data-icon="inline-start" />
              </Button>
            </SheetClose>
          </SheetHeader>
          <div className="staff-mobile-sidebar-provider">
            <NavigationPanel admin={admin} pathname={pathname} onNavigate={() => setOpen(false)} />
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
