import Link from "next/link";
import { CircleUserRound } from "lucide-react";

import { AuthShell } from "@/components/layout/auth-shell";
import { Button } from "@/components/ui/button";

export default function TeacherLoginPage() {
  return (
    <AuthShell
      title="교사 로그인"
      description="교사 가입과 교사 기능은 현재 Google로 인증한 계정만 사용할 수 있습니다."
    >
      <Button asChild className="w-full">
        <Link href="/auth/teacher/start">
          <CircleUserRound data-icon="inline-start" />
          Google로 교사 가입 계속하기
        </Link>
      </Button>
    </AuthShell>
  );
}
