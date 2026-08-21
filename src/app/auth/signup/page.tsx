"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";

import { createBrowserSupabaseClient } from "@/lib/supabase/client";

export default function StudentSignupPage() {
  const [message, setMessage] = useState<string>();

  async function signup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const { error } = await createBrowserSupabaseClient().auth.signUp({
      email: String(form.get("email") ?? ""),
      password: String(form.get("password") ?? ""),
      options: { emailRedirectTo: `${window.location.origin}/auth/callback?next=/onboarding` },
    });
    setMessage(error?.message ?? "인증 이메일을 확인한 뒤 계속해 주세요.");
  }

  return (
    <main>
      <h1>학생 회원가입</h1>
      <form onSubmit={signup}>
        <label>이메일<input name="email" type="email" required /></label>
        <label>비밀번호<input name="password" type="password" minLength={8} required /></label>
        <button type="submit">회원가입</button>
      </form>
      {message ? <p role="status">{message}</p> : null}
      <Link href="/auth/login">로그인으로 돌아가기</Link>
    </main>
  );
}
