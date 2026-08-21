"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { api } from "@/lib/api/client";

type Me = { onboarding_completed: boolean; capabilities: { student: boolean } };

export default function StudentPage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    api.get<Me>("/api/me")
      .then((me) => {
        if (!me.onboarding_completed || !me.capabilities.student) router.replace("/onboarding");
        else setReady(true);
      })
      .catch(() => router.replace("/auth/login"));
  }, [router]);

  if (!ready) return <main>학생 정보를 확인하고 있습니다.</main>;
  return <main><h1>학생 출결</h1><p>오늘의 출결과 QR 스캔 기능을 이용할 수 있습니다.</p></main>;
}
