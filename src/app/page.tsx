import Link from "next/link";

export default function HomePage() {
  return (
    <main>
      <h1>교회 출결</h1>
      <Link href="/teacher/login">교사로 로그인</Link>
      <Link href="/auth/login">학생으로 로그인</Link>
    </main>
  );
}
