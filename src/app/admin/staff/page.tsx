"use client";

import { useEffect, useState } from "react";

import { api, ApiClientError } from "@/lib/api/client";

type StaffRole = "teacher" | "admin";
type StaffMember = {
  user_id: string;
  email: string;
  name: string;
  phone: string | null;
  role: StaffRole;
};

export default function StaffPage() {
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [error, setError] = useState<string>();

  useEffect(() => {
    api.get<StaffMember[]>("/api/admin/staff")
      .then(setStaff)
      .catch((caught) => setError(caught instanceof ApiClientError ? caught.message : "교직원 목록을 불러오지 못했습니다."));
  }, []);

  async function changeRole(member: StaffMember) {
    const nextRole: StaffRole = member.role === "admin" ? "teacher" : "admin";
    const label = nextRole === "admin" ? "관리자로 승격" : "교사로 변경";
    if (!window.confirm(`${member.name} 님을 ${label}하시겠습니까?`)) return;
    try {
      const changed = await api.patch<StaffMember>(
        `/api/admin/staff/${member.user_id}/role`,
        { role: nextRole },
      );
      setStaff((current) => current.map((item) => item.user_id === changed.user_id ? changed : item));
    } catch (caught) {
      setError(caught instanceof ApiClientError ? caught.message : "역할을 변경하지 못했습니다.");
    }
  }

  return (
    <main>
      <h1>교직원 역할 관리</h1>
      <p>역할 변경은 즉시 적용됩니다. 변경 전에 대상과 역할을 다시 확인해 주세요.</p>
      {error ? <p role="alert">{error}</p> : null}
      <ul>
        {staff.map((member) => (
          <li key={member.user_id}>
            <strong>{member.name}</strong> {member.email} · {member.role === "admin" ? "관리자" : "교사"}
            <button type="button" onClick={() => changeRole(member)}>
              {member.role === "admin" ? "교사로 변경" : "관리자로 승격"}
            </button>
          </li>
        ))}
      </ul>
    </main>
  );
}
