"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";

import { StaffShell } from "@/components/layout/staff-shell";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { api, ApiClientError } from "@/lib/api/client";

type Me = { capabilities: { teacher: boolean; admin: boolean } };

export type ProtectedStaffLayoutProps = {
  children: ReactNode;
  requireAdmin?: boolean;
};

export function ProtectedStaffLayout({ children, requireAdmin = false }: ProtectedStaffLayoutProps) {
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
        if (requireAdmin && !me.capabilities.admin) {
          active = false;
          router.replace("/teacher");
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
  }, [attempt, requireAdmin, router]);

  if (error) {
    return (
      <main className="staff-access-state">
        <Alert variant="destructive">
          <AlertTitle>교사 메뉴를 열 수 없습니다.</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
        <Button type="button" onClick={() => { setError(undefined); setAttempt((value) => value + 1); }}>
          다시 시도
        </Button>
      </main>
    );
  }

  if (admin === undefined) {
    return (
      <main className="staff-access-state">
        <div className="staff-access-state__loading">
          <Skeleton className="h-5 w-48" />
          <p role="status">교사 권한을 확인하고 있습니다.</p>
        </div>
      </main>
    );
  }

  return <StaffShell admin={admin}>{children}</StaffShell>;
}
