import { redirect } from "next/navigation";

export default function TeacherApplicationsPage() {
  redirect("/auth/continue");
  return null;
}
