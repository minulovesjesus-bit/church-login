"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { CircleUserRound } from "lucide-react";

import { AuthShell } from "@/components/layout/auth-shell";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, FieldGroup, FieldLabel, FieldSeparator } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { createBrowserSupabaseClient } from "@/lib/supabase/client";

export default function StudentLoginPage() {
  const router = useRouter();
  const [error, setError] = useState<string>();
  const [submitting, setSubmitting] = useState<"google" | "password">();

  async function loginWithPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;
    setSubmitting("password");
    setError(undefined);
    const form = new FormData(event.currentTarget);
    try {
      const { error: authError } = await createBrowserSupabaseClient().auth.signInWithPassword({
        email: String(form.get("email") ?? ""),
        password: String(form.get("password") ?? ""),
      });
      setError(authError?.message);
      if (!authError) router.push("/student");
    } finally {
      setSubmitting(undefined);
    }
  }

  async function loginWithGoogle() {
    if (submitting) return;
    setSubmitting("google");
    setError(undefined);
    try {
      const { error: authError } = await createBrowserSupabaseClient().auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo: `${window.location.origin}/auth/callback?next=/student` },
      });
      setError(authError?.message);
    } finally {
      setSubmitting(undefined);
    }
  }

  return (
    <AuthShell title="학생 로그인">
      <FieldGroup>
        <Button
          type="button"
          variant="outline"
          className="w-full"
          disabled={Boolean(submitting)}
          onClick={loginWithGoogle}
        >
          {submitting === "google" ? <Spinner data-icon="inline-start" aria-hidden /> : <CircleUserRound data-icon="inline-start" />}
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
        <Button asChild variant="link" className="w-fit px-0">
          <Link href="/auth/signup">회원가입</Link>
        </Button>
      </FieldGroup>
    </AuthShell>
  );
}
