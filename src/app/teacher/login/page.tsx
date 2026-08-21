"use client";

import { useState } from "react";

import { createBrowserSupabaseClient } from "@/lib/supabase/client";

export default function TeacherLoginPage() {
  const [error, setError] = useState<string>();

  async function loginWithGoogle() {
    setError(undefined);
    const callback = new URL("/auth/callback", window.location.origin);
    callback.searchParams.set("next", "/teacher/apply");
    const { error: authError } = await createBrowserSupabaseClient().auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: callback.toString() },
    });
    setError(authError?.message);
  }

  return (
    <main>
      <h1>교사 로그인</h1>
      <p>교사 가입과 교사 기능은 현재 Google로 인증한 계정만 사용할 수 있습니다.</p>
      <button type="button" onClick={loginWithGoogle}>Google로 교사 가입 계속하기</button>
      {error ? <p role="alert">{error}</p> : null}
    </main>
  );
}
