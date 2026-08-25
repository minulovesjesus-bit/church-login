"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState, type FormEvent } from "react";

import { GoogleMark } from "@/components/brand/google-mark";
import { AuthShell } from "@/components/layout/auth-shell";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, FieldGroup, FieldLabel, FieldSeparator } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { createBrowserSupabaseClient } from "@/lib/supabase/client";

const OAUTH_CALLBACK_ERROR_MESSAGE = "로그인을 완료하지 못했습니다. 다시 시도해 주세요.";

export default function StudentLoginPage() {
  return (
    <Suspense fallback={<AuthShell title="로그인"><p role="status">로그인 화면을 준비하고 있습니다.</p></AuthShell>}>
      <StudentLoginForm />
    </Suspense>
  );
}

function StudentLoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const callbackError = searchParams.get("error") === "oauth_callback"
    ? OAUTH_CALLBACK_ERROR_MESSAGE
    : undefined;
  const [actionError, setActionError] = useState<string | null>();
  const error = actionError === undefined ? callbackError : actionError ?? undefined;
  const [submitting, setSubmitting] = useState<"google" | "password">();

  async function loginWithPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;
    setSubmitting("password");
    setActionError(null);
    const form = new FormData(event.currentTarget);
    try {
      const { error: authError } = await createBrowserSupabaseClient().auth.signInWithPassword({
        email: String(form.get("email") ?? ""),
        password: String(form.get("password") ?? ""),
      });
      setActionError(authError?.message ?? null);
      if (!authError) router.push("/auth/continue");
    } finally {
      setSubmitting(undefined);
    }
  }

  async function loginWithGoogle() {
    if (submitting) return;
    setSubmitting("google");
    setActionError(null);
    try {
      const callbackUrl = new URL(
        "/auth/callback?next=/auth/continue",
        window.location.origin,
      );
      if (callbackUrl.hostname === "0.0.0.0" || callbackUrl.hostname === "127.0.0.1") {
        callbackUrl.hostname = "localhost";
      }
      const { error: authError } = await createBrowserSupabaseClient().auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo: callbackUrl.toString() },
      });
      setActionError(authError?.message ?? null);
    } finally {
      setSubmitting(undefined);
    }
  }

  return (
    <AuthShell title="로그인">
      <FieldGroup>
        <Button
          type="button"
          variant="outline"
          className="w-full"
          disabled={Boolean(submitting)}
          onClick={loginWithGoogle}
        >
          {submitting === "google" ? (
            <Spinner data-icon="inline-start" aria-hidden />
          ) : (
            <GoogleMark data-icon="inline-start" />
          )}
          Google로 계속하기
        </Button>
        <FieldSeparator>또는</FieldSeparator>
        <form onSubmit={loginWithPassword}>
          <FieldGroup>
            <Field data-invalid={Boolean(error)}>
              <FieldLabel htmlFor="student-login-email">이메일</FieldLabel>
              <Input
                id="student-login-email"
                name="email"
                type="email"
                autoComplete="email"
                aria-invalid={Boolean(error)}
                aria-describedby={error ? "student-login-error" : undefined}
                disabled={Boolean(submitting)}
                required
              />
            </Field>
            <Field data-invalid={Boolean(error)}>
              <FieldLabel htmlFor="student-login-password">비밀번호</FieldLabel>
              <Input
                id="student-login-password"
                name="password"
                type="password"
                autoComplete="current-password"
                aria-invalid={Boolean(error)}
                aria-describedby={error ? "student-login-error" : undefined}
                disabled={Boolean(submitting)}
                required
              />
            </Field>
            {error ? (
              <Alert id="student-login-error" variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            ) : null}
            <Button type="submit" className="w-full" disabled={Boolean(submitting)}>
              {submitting === "password" ? (
                <>
                  <Spinner data-icon="inline-start" aria-hidden />
                  로그인 중
                </>
              ) : "로그인"}
            </Button>
          </FieldGroup>
        </form>
        <Button asChild variant="outline" className="w-full">
          <Link href="/auth/signup">회원가입</Link>
        </Button>
      </FieldGroup>
    </AuthShell>
  );
}
