"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { api, ApiClientError } from "@/lib/api/client";

type Me = { capabilities: { teacher: boolean } };

export default function TeacherPage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    let active = true;
    api.get<Me>("/api/me")
      .then((me) => {
        if (!active) return;
        if (!me.capabilities.teacher) {
          router.replace("/teacher/apply");
          return;
        }
        setReady(true);
      })
      .catch((caught: unknown) => {
        if (!active) return;
        if (caught instanceof ApiClientError && caught.code === "AUTH_REQUIRED") {
          router.replace("/teacher/login");
          return;
        }
        setError(caught instanceof ApiClientError ? caught.message : "교사 권한을 확인하지 못했습니다.");
      });
    return () => {
      active = false;
    };
  }, [router]);

  if (error) return <main><p role="alert">{error}</p></main>;
  if (!ready) return <main><p role="status">교사 권한을 확인하고 있습니다.</p></main>;
  return <main><h1>교사 대시보드</h1><p>교사 권한이 확인되었습니다.</p></main>;
}
