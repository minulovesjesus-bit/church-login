import { redirect } from "next/navigation";

export default function TeacherApplicationPage() {
  redirect("/auth/continue");
  return null;
}
