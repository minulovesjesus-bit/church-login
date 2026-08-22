"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { CircleUserRound } from "lucide-react";

import { AuthShell } from "@/components/layout/auth-shell";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, FieldGroup, FieldLabel, FieldSeparator } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { createBrowserSupabaseClient } from "@/lib/supabase/client";

export default function StudentSignupPage() {
  const [message, setMessage] = useState<string>();
  const [hasError, setHasError] = useState(false);
  const [submitting, setSubmitting] = useState<"google" | "password">();

  async function signup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;
    setSubmitting("password");
    setMessage(undefined);
    setHasError(false);
    const form = new FormData(event.currentTarget);
    try {
      const { error } = await createBrowserSupabaseClient().auth.signUp({
        email: String(form.get("email") ?? ""),
        password: String(form.get("password") ?? ""),
        options: { emailRedirectTo: `${window.location.origin}/auth/callback?next=/student` },
      });
      setHasError(Boolean(error));
      setMessage(error?.message ?? "인증 이메일을 확인한 뒤 계속해 주세요.");
    } finally {
      setSubmitting(undefined);
    }
  }

  async function signupWithGoogle() {
    if (submitting) return;
    setSubmitting("google");
    setMessage(undefined);
    setHasError(false);
    try {
      const { error } = await createBrowserSupabaseClient().auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo: `${window.location.origin}/auth/callback?next=/student` },
      });
      setHasError(Boolean(error));
      setMessage(error?.message);
    } finally {
      setSubmitting(undefined);
    }
  }

  return (
    <AuthShell title="학생 회원가입">
      <FieldGroup>
        <Button
          type="button"
          variant="outline"
          className="w-full"
          disabled={Boolean(submitting)}
          onClick={signupWithGoogle}
        >
          {submitting === "google" ? <Spinner data-icon="inline-start" aria-hidden /> : <CircleUserRound data-icon="inline-start" />}
          Google로 계속하기
        </Button>
        <FieldSeparator>또는</FieldSeparator>
        <form onSubmit={signup}>
          <FieldGroup>
            <Field data-invalid={hasError}>
              <FieldLabel htmlFor="student-signup-email">이메일</FieldLabel>
              <Input
                id="student-signup-email"
                name="email"
                type="email"
                autoComplete="email"
                aria-invalid={hasError}
                aria-describedby={message ? "student-signup-message" : undefined}
                disabled={Boolean(submitting)}
                required
              />
            </Field>
            <Field data-invalid={hasError}>
              <FieldLabel htmlFor="student-signup-password">비밀번호</FieldLabel>
              <Input
                id="student-signup-password"
                name="password"
                type="password"
                autoComplete="new-password"
                minLength={8}
                aria-invalid={hasError}
                aria-describedby={message ? "student-signup-message" : undefined}
                disabled={Boolean(submitting)}
                required
              />
            </Field>
            {message ? (
              hasError ? (
                <Alert id="student-signup-message" variant="destructive">
                  <AlertDescription>{message}</AlertDescription>
                </Alert>
              ) : (
                <Alert id="student-signup-message" role="status">
                  <AlertDescription>{message}</AlertDescription>
                </Alert>
              )
            ) : null}
            <Button type="submit" className="w-full" disabled={Boolean(submitting)}>
              {submitting === "password" ? (
                <>
                  <Spinner data-icon="inline-start" aria-hidden />
                  가입 중
                </>
              ) : "회원가입"}
            </Button>
          </FieldGroup>
        </form>
        <Button asChild variant="link" className="w-fit px-0">
          <Link href="/auth/login">로그인으로 돌아가기</Link>
        </Button>
      </FieldGroup>
    </AuthShell>
  );
}
