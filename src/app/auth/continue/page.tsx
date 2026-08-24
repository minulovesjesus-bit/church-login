"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { AuthShell } from "@/components/layout/auth-shell";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { api, ApiClientError } from "@/lib/api/client";
import { createBrowserSupabaseClient } from "@/lib/supabase/client";

type CurrentIdentity = {
  onboarding_completed: boolean;
  capabilities: {
    student: boolean;
    teacher: boolean;
    admin: boolean;
  };
};

function destination(identity: CurrentIdentity): string {
  if (!identity.onboarding_completed) return "/onboarding";
  if (identity.capabilities.teacher || identity.capabilities.admin) return "/teacher";
  return "/student";
}

export default function AuthContinuePage() {
  const router = useRouter();
  const [attempt, setAttempt] = useState(0);
  const [error, setError] = useState<string>();

  useEffect(() => {
    const controller = new AbortController();
    let active = true;

    async function continueAuthentication() {
      setError(undefined);
      try {
        const { data, error: sessionError } = await createBrowserSupabaseClient().auth.getSession();
        if (!active) return;
        if (sessionError || !data.session) {
          router.replace("/login");
          return;
        }

        const identity = await api.get<CurrentIdentity>("/api/me", { signal: controller.signal });
        if (active) router.replace(destination(identity));
      } catch (caught: unknown) {
        if (!active || (caught instanceof DOMException && caught.name === "AbortError")) return;
        if (caught instanceof ApiClientError && caught.code === "AUTH_REQUIRED") {
          router.replace("/login");
          return;
        }
        setError(caught instanceof ApiClientError ? caught.message : "로그인 정보를 확인하지 못했습니다.");
      }
    }

    void continueAuthentication();
    return () => {
      active = false;
      controller.abort();
    };
  }, [attempt, router]);

  if (error) {
    return (
      <AuthShell title="로그인을 계속할 수 없습니다.">
        <Alert variant="destructive">
          <AlertTitle>로그인 정보를 확인하지 못했습니다.</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
        <Button type="button" onClick={() => setAttempt((value) => value + 1)}>
          다시 시도
        </Button>
      </AuthShell>
    );
  }

  return (
    <AuthShell title="로그인 정보를 확인하고 있어요.">
      <p className="flex items-center gap-2 text-muted-foreground" role="status">
        <Spinner aria-hidden />
        잠시만 기다려 주세요.
      </p>
    </AuthShell>
  );
}
