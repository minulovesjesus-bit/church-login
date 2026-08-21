"use client";

import { useEffect, useState, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";

import { TeacherNavigation } from "@/components/navigation/teacher-navigation";
import { api, ApiClientError } from "@/lib/api/client";

type Me = { capabilities: { teacher: boolean; admin: boolean } };

function ProtectedTeacherLayout({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [admin, setAdmin] = useState<boolean>();
  const [error, setError] = useState<string>();
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    api.get<Me>("/api/me", { signal: controller.signal })
      .then((me) => {
        if (!active) return;
        if (!me.capabilities.teacher) {
          active = false;
          router.replace("/teacher/apply");
          return;
        }
        setAdmin(me.capabilities.admin === true);
      })
      .catch((caught: unknown) => {
        if (!active || (caught instanceof DOMException && caught.name === "AbortError")) return;
        if (caught instanceof ApiClientError && caught.code === "AUTH_REQUIRED") {
          active = false;
          router.replace("/teacher/login");
          return;
        }
        if (caught instanceof ApiClientError && caught.code === "FORBIDDEN") {
          active = false;
          router.replace("/teacher/apply");
          return;
        }
        setError(caught instanceof ApiClientError ? caught.message : "교사 메뉴를 불러오지 못했습니다.");
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [attempt, router]);

  if (error) {
    return <main className="teacher-access-state"><p role="alert">{error}</p><button type="button" className="primary-button" onClick={() => { setError(undefined); setAttempt((value) => value + 1); }}>다시 시도</button></main>;
  }
  if (admin === undefined) return <main className="teacher-access-state"><p role="status">교사 권한을 확인하고 있습니다.</p></main>;
  return <div className="teacher-layout"><TeacherNavigation admin={admin} /><div className="teacher-layout__content">{children}</div></div>;
}

export default function TeacherLayout({ children }: Readonly<{ children: ReactNode }>) {
  const pathname = usePathname();
  if (pathname === "/teacher/login" || pathname === "/teacher/apply") return children;
  return <ProtectedTeacherLayout>{children}</ProtectedTeacherLayout>;
}
