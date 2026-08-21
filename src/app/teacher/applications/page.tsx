"use client";

import { useEffect, useState } from "react";

import { api, ApiClientError } from "@/lib/api/client";

type Application = {
  id: string;
  user_id: string;
  email: string;
  name: string;
  phone: string;
  status: "pending";
};

export default function TeacherApplicationsPage() {
  const [applications, setApplications] = useState<Application[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();

  useEffect(() => {
    let active = true;
    api.get<Application[]>("/api/admin/teacher-applications")
      .then((response) => {
        if (active) {
          setApplications(response);
          setLoading(false);
        }
      })
      .catch((caught) => {
        if (active) {
          setError(caught instanceof ApiClientError ? caught.message : "신청 목록을 불러오지 못했습니다.");
          setLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, []);

  async function approve(application: Application) {
    if (!window.confirm(`${application.name} 님을 교사로 승인하시겠습니까?`)) return;
    setError(undefined);
    try {
      await api.post(`/api/admin/teacher-applications/${application.id}/approve`, {});
      setApplications((current) => current.filter((item) => item.id !== application.id));
    } catch (caught) {
      setError(caught instanceof ApiClientError ? caught.message : "교사 승인을 처리하지 못했습니다.");
    }
  }

  async function reject(application: Application) {
    if (!window.confirm(`${application.name} 님의 신청을 거절하시겠습니까?`)) return;
    const reason = window.prompt("거절 사유를 입력해 주세요.");
    if (!reason?.trim()) return;
    setError(undefined);
    try {
      await api.post(`/api/admin/teacher-applications/${application.id}/reject`, {
        rejection_reason: reason.trim(),
      });
      setApplications((current) => current.filter((item) => item.id !== application.id));
    } catch (caught) {
      setError(caught instanceof ApiClientError ? caught.message : "신청 거절을 처리하지 못했습니다.");
    }
  }

  return (
    <main>
      <h1>교사 가입 신청 관리</h1>
      {error ? <p role="alert">{error}</p> : null}
      {loading ? <p role="status">신청 목록을 불러오고 있습니다.</p> : null}
      {!loading && !error && applications.length === 0 ? <p>대기 중인 신청이 없습니다.</p> : null}
      <ul>
        {applications.map((application) => (
          <li key={application.id}>
            <strong>{application.name}</strong> {application.email} {application.phone}
            <button type="button" onClick={() => approve(application)}>승인</button>
            <button type="button" onClick={() => reject(application)}>거절</button>
          </li>
        ))}
      </ul>
    </main>
  );
}
