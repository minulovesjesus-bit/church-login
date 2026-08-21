"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";

import { api, ApiClientError } from "@/lib/api/client";

type ApplicationStatus = "none" | "pending" | "rejected" | "approved";
type ApplicationStateResponse = {
  status: ApplicationStatus;
  rejection_reason: string | null;
};

const digitsOnly = (value: string) => value.replace(/\D/g, "");

function TeacherApplicationForm({ resubmission = false, onPending }: {
  resubmission?: boolean;
  onPending: () => void;
}) {
  const [error, setError] = useState<string>();

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(undefined);
    const form = new FormData(event.currentTarget);
    try {
      await api.post("/api/teacher-applications", {
        name: String(form.get("name") ?? "").trim(),
        phone: digitsOnly(String(form.get("phone") ?? "")),
      });
      onPending();
    } catch (caught) {
      setError(caught instanceof ApiClientError ? caught.message : "교사 가입을 신청하지 못했습니다.");
    }
  }

  return (
    <form onSubmit={submit}>
      <label>이름<input name="name" required maxLength={80} /></label>
      <label>연락처<input name="phone" inputMode="numeric" required /></label>
      {error ? <p role="alert">{error}</p> : null}
      <button type="submit">{resubmission ? "다시 신청" : "교사 가입 신청"}</button>
    </form>
  );
}

export function ApplicationState({
  status,
  rejectionReason,
  onPending,
}: {
  status: ApplicationStatus;
  rejectionReason?: string | null;
  onPending: () => void;
}) {
  if (status === "pending") return <p>교사 가입 승인을 기다리고 있습니다.</p>;
  if (status === "rejected") {
    return (
      <section>
        <p>신청이 거절되었습니다. 정보를 확인해 다시 신청할 수 있습니다.</p>
        {rejectionReason ? <p>거절 사유: {rejectionReason}</p> : null}
        <TeacherApplicationForm resubmission onPending={onPending} />
      </section>
    );
  }
  if (status === "approved") return <Link href="/teacher">교사 대시보드로 이동</Link>;
  return <TeacherApplicationForm onPending={onPending} />;
}

export default function TeacherApplicationPage() {
  const [state, setState] = useState<ApplicationStateResponse>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    let active = true;
    api.get<ApplicationStateResponse>("/api/teacher-applications/me")
      .then((response) => {
        if (active) setState(response);
      })
      .catch((caught) => {
        if (active) {
          setError(caught instanceof ApiClientError ? caught.message : "신청 상태를 확인하지 못했습니다.");
        }
      });
    return () => {
      active = false;
    };
  }, []);

  return (
    <main>
      <h1>교사 가입 신청</h1>
      {error ? <p role="alert">{error}</p> : null}
      {!state && !error ? <p role="status">신청 상태를 확인하고 있습니다.</p> : null}
      {state ? (
        <ApplicationState
          status={state.status}
          rejectionReason={state.rejection_reason}
          onPending={() => setState({ status: "pending", rejection_reason: null })}
        />
      ) : null}
    </main>
  );
}
