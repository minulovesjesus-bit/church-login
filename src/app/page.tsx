import Link from "next/link";
import { ChevronRight, GraduationCap, UsersRound } from "lucide-react";

import { AuthShell } from "@/components/layout/auth-shell";
import { Button } from "@/components/ui/button";

export default function HomePage() {
  return (
    <AuthShell
      title="함께하는 오늘, 안심되는 출결"
      description="학생과 교사가 한곳에서 출결과 일정을 확인해요."
      imagePriority
    >
      <div className="flex flex-col gap-3">
        <Button asChild className="min-h-16 w-full justify-between px-5">
          <Link href="/auth/login">
            <GraduationCap data-icon="inline-start" />
            학생으로 로그인
            <ChevronRight data-icon="inline-end" />
          </Link>
        </Button>
        <Button asChild variant="outline" className="min-h-16 w-full justify-between px-5">
          <Link href="/teacher/login">
            <UsersRound data-icon="inline-start" />
            교사로 로그인
            <ChevronRight data-icon="inline-end" />
          </Link>
        </Button>
      </div>
      <Button asChild variant="link" className="w-fit px-0">
        <Link href="/auth/signup">학생 회원가입</Link>
      </Button>
    </AuthShell>
  );
}
