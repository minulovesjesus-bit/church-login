"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { createBrowserSupabaseClient } from "@/lib/supabase/client";

type SessionRequest = ReturnType<ReturnType<typeof createBrowserSupabaseClient>["auth"]["getSession"]>;
type SessionStatus = "checking" | "authenticated" | "error";

export function StudentSessionGuard({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [status, setStatus] = useState<SessionStatus>("checking");
  const [attempt, setAttempt] = useState(0);
  const requestRef = useRef<SessionRequest | null>(null);

  useEffect(() => {
    let active = true;

    function requestSession(): SessionRequest {
      if (requestRef.current) return requestRef.current;

      const request = createBrowserSupabaseClient().auth.getSession();
      requestRef.current = request;
      request.then(
        () => {
          if (requestRef.current === request) requestRef.current = null;
        },
        () => {
          if (requestRef.current === request) requestRef.current = null;
        },
      );
      return request;
    }

    async function verifySession() {
      setStatus("checking");
      try {
        const { data, error } = await requestSession();
        if (!active) return;
        if (error) {
          setStatus("error");
          return;
        }
        if (!data.session) {
          router.replace("/login");
          return;
        }
        setStatus("authenticated");
      } catch {
        if (active) setStatus("error");
      }
    }

    function handlePageShow(event: PageTransitionEvent) {
      if (event.persisted) void verifySession();
    }

    window.addEventListener("pageshow", handlePageShow);
    void verifySession();

    return () => {
      active = false;
      window.removeEventListener("pageshow", handlePageShow);
    };
  }, [attempt, router]);

  if (status === "authenticated") return children;

  if (status === "error") {
    return (
      <div className="student-shell min-h-dvh bg-background text-foreground">
        <div className="flex min-h-dvh items-center justify-center px-4">
          <div className="flex max-w-sm flex-col items-center gap-3 text-center" role="alert">
            <p className="font-medium">로그인 상태를 확인하지 못했습니다.</p>
            <p className="text-sm text-muted-foreground">네트워크 연결을 확인한 뒤 다시 시도해 주세요.</p>
            <Button type="button" variant="outline" onClick={() => setAttempt((current) => current + 1)}>
              다시 시도
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="student-shell min-h-dvh bg-background text-foreground">
      <div className="flex min-h-dvh items-center justify-center" role="status">
        <span className="sr-only">로그인 상태를 확인하고 있습니다.</span>
      </div>
    </div>
  );
}
