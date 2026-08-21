"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";

import { createBrowserSupabaseClient } from "@/lib/supabase/client";

export default function StudentLoginPage() {
  const [error, setError] = useState<string>();

  async function loginWithPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const { error: authError } = await createBrowserSupabaseClient().auth.signInWithPassword({
      email: String(form.get("email") ?? ""),
      password: String(form.get("password") ?? ""),
    });
    setError(authError?.message);
    if (!authError) window.location.assign("/onboarding");
  }

  async function loginWithGoogle() {
    const { error: authError } = await createBrowserSupabaseClient().auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/auth/callback?next=/onboarding` },
    });
    setError(authError?.message);
  }

  return (
    <main>
      <h1>학생 로그인</h1>
      <button type="button" onClick={loginWithGoogle}>Google로 계속하기</button>
      <form onSubmit={loginWithPassword}>
        <label>이메일<input name="email" type="email" required /></label>
        <label>비밀번호<input name="password" type="password" required /></label>
        <button type="submit">로그인</button>
      </form>
      {error ? <p role="alert">{error}</p> : null}
      <Link href="/auth/signup">회원가입</Link>
    </main>
  );
}
