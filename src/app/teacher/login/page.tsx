import Link from "next/link";

export default function TeacherLoginPage() {
  return (
    <main>
      <h1>교사 로그인</h1>
      <p>교사 가입과 교사 기능은 현재 Google로 인증한 계정만 사용할 수 있습니다.</p>
      <Link href="/auth/teacher/start">Google로 교사 가입 계속하기</Link>
    </main>
  );
}
