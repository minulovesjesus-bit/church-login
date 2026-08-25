"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";

import { AuthShell } from "@/components/layout/auth-shell";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { authIssue } from "@/lib/auth/error-message";
import { createBrowserSupabaseClient } from "@/lib/supabase/client";

export default function StudentSignupPage() {
  const [message, setMessage] = useState<string>();
  const [hasError, setHasError] = useState(false);
  const [errorField, setErrorField] = useState<"email" | "password">();
  const [submitting, setSubmitting] = useState(false);

  async function signup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setMessage(undefined);
    setHasError(false);
    setErrorField(undefined);
    const form = new FormData(event.currentTarget);
    try {
      const { error } = await createBrowserSupabaseClient().auth.signUp({
        email: String(form.get("email") ?? ""),
        password: String(form.get("password") ?? ""),
        options: { emailRedirectTo: `${window.location.origin}/auth/callback?next=/auth/continue` },
      });
      const issue = authIssue(error, "signup");
      setHasError(Boolean(issue));
      setErrorField(issue?.field);
      setMessage(issue?.message ?? "인증 이메일을 확인한 뒤 계속해 주세요.");
    } catch {
      const issue = authIssue({ message: "network" }, "signup");
      setHasError(true);
      setErrorField(issue?.field);
      setMessage(issue?.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthShell title="회원가입" description="학생과 교사가 하나의 계정을 사용합니다.">
      <FieldGroup>
        <form onSubmit={signup}>
          <FieldGroup>
            <Field data-invalid={hasError && (!errorField || errorField === "email")}>
              <FieldLabel htmlFor="student-signup-email">이메일</FieldLabel>
              <Input
                id="student-signup-email"
                name="email"
                type="email"
                autoComplete="email"
                aria-invalid={hasError && (!errorField || errorField === "email")}
                aria-describedby={hasError && (!errorField || errorField === "email") ? "student-signup-message" : undefined}
                disabled={submitting}
                required
              />
            </Field>
            <Field data-invalid={hasError && (!errorField || errorField === "password")}>
              <FieldLabel htmlFor="student-signup-password">비밀번호</FieldLabel>
              <Input
                id="student-signup-password"
                name="password"
                type="password"
                autoComplete="new-password"
                minLength={8}
                aria-invalid={hasError && (!errorField || errorField === "password")}
                aria-describedby={hasError && (!errorField || errorField === "password") ? "student-signup-message" : undefined}
                disabled={submitting}
                required
              />
              <FieldDescription>비밀번호는 8자 이상 입력해 주세요.</FieldDescription>
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
            <Button type="submit" className="w-full" disabled={submitting}>
              {submitting ? (
                <>
                  <Spinner data-icon="inline-start" aria-hidden />
                  가입 중
                </>
              ) : "회원가입"}
            </Button>
          </FieldGroup>
        </form>
        <Button asChild variant="link" className="w-fit px-0">
          <Link href="/login">로그인으로 돌아가기</Link>
        </Button>
        <p className="m-0 text-sm leading-relaxed text-muted-foreground">
          모든 계정은 기본 정보를 먼저 등록합니다. 교사로 활동할 계정은 가입 후 관리자가 기존 계정에 교사 권한을 추가합니다.
        </p>
      </FieldGroup>
    </AuthShell>
  );
}
