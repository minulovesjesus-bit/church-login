"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { api, ApiClientError } from "@/lib/api/client";

type Application = { id: string; user_id: string; email: string; name: string; phone: string; status: "pending" };
type ListState =
  | { status: "loading" }
  | { status: "ready"; applications: Application[] }
  | { status: "error"; message: string }
  | { status: "auth" };

function authorizationDestination(error: unknown): string | undefined {
  if (!(error instanceof ApiClientError)) return undefined;
  if (error.code === "AUTH_REQUIRED") return "/teacher/login";
  if (error.code === "FORBIDDEN") return "/teacher";
  return undefined;
}

export default function TeacherApplicationsPage() {
  const router = useRouter();
  const [state, setState] = useState<ListState>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [pendingId, setPendingId] = useState<string>();
  const [mutationError, setMutationError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const mountedRef = useRef(true);
  const terminalAuthRef = useRef(false);
  const sequenceRef = useRef(0);
  const mutationRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; sequenceRef.current += 1; mutationRef.current = false; };
  }, []);

  const terminalAuthorization = useCallback((error: unknown) => {
    const destination = authorizationDestination(error);
    if (!destination || !mountedRef.current || terminalAuthRef.current) return false;
    terminalAuthRef.current = true;
    sequenceRef.current += 1;
    mutationRef.current = false;
    setPendingId(undefined);
    setState({ status: "auth" });
    router.replace(destination);
    return true;
  }, [router]);

  const loadApplications = useCallback(async () => {
    const sequence = sequenceRef.current + 1;
    sequenceRef.current = sequence;
    try {
      const applications = await api.get<Application[]>("/api/admin/teacher-applications");
      if (mountedRef.current && !terminalAuthRef.current && sequence === sequenceRef.current) {
        setState({ status: "ready", applications });
      }
    } catch (error) {
      if (!mountedRef.current || sequence !== sequenceRef.current) return;
      if (terminalAuthorization(error)) return;
      setState({ status: "error", message: error instanceof ApiClientError ? error.message : "신청 목록을 불러오지 못했습니다." });
    }
  }, [terminalAuthorization]);

  useEffect(() => {
    queueMicrotask(() => { void loadApplications(); });
  }, [attempt, loadApplications]);

  async function decide(application: Application, decision: "approved" | "rejected") {
    if (mutationRef.current || terminalAuthRef.current) return;
    const confirmed = window.confirm(decision === "approved"
      ? `${application.name} 님을 교사로 승인하시겠습니까? 즉시 교사 기능을 사용할 수 있게 됩니다.`
      : `${application.name} 님의 신청을 거절하시겠습니까? 신청자는 거절 상태와 사유를 확인하게 됩니다.`);
    if (!confirmed) return;

    let rejectionReason: string | undefined;
    if (decision === "rejected") {
      rejectionReason = window.prompt("거절 사유를 입력해 주세요.")?.trim();
      if (!rejectionReason) { setMutationError("거절 사유를 입력해 주세요."); return; }
      if (rejectionReason.length > 500) { setMutationError("거절 사유는 500자 이하여야 합니다."); return; }
    }

    mutationRef.current = true;
    setPendingId(application.id);
    setMutationError(undefined);
    setNotice(undefined);
    const sequence = sequenceRef.current;
    try {
      const suffix = decision === "approved" ? "approve" : "reject";
      await api.post(`/api/admin/teacher-applications/${application.id}/${suffix}`, decision === "approved" ? {} : { rejection_reason: rejectionReason });
      if (!mountedRef.current || terminalAuthRef.current || sequence !== sequenceRef.current) return;
      setState((current) => current.status === "ready"
        ? { status: "ready", applications: current.applications.filter((item) => item.id !== application.id) }
        : current);
      setNotice(`${application.name} 님의 신청을 ${decision === "approved" ? "승인" : "거절"}했습니다.`);
    } catch (error) {
      if (!mountedRef.current || terminalAuthRef.current) return;
      if (terminalAuthorization(error)) return;
      if (error instanceof ApiClientError && error.code === "APPLICATION_ALREADY_REVIEWED") {
        await loadApplications();
        return;
      }
      setMutationError(error instanceof ApiClientError ? error.message : "신청을 처리하지 못했습니다.");
    } finally {
      if (mountedRef.current && !terminalAuthRef.current) { mutationRef.current = false; setPendingId(undefined); }
    }
  }

  if (state.status === "auth") return null;
  return (
    <main className="admin-page">
      <header className="admin-page__header"><p className="eyebrow">Administrator</p><h1>교사 가입 신청 관리</h1><p className="supporting-copy">신청자의 정보를 확인한 뒤 교사 권한 승인 또는 거절을 결정합니다.</p></header>
      {mutationError ? <p className="inline-alert" role="alert">{mutationError}</p> : null}
      {notice ? <p className="notice" role="status">{notice}</p> : null}
      {state.status === "loading" ? <p role="status">신청 목록을 불러오고 있습니다.</p> : null}
      {state.status === "error" ? <section className="admin-state"><p className="inline-alert" role="alert">{state.message}</p><button className="secondary-button" type="button" onClick={() => { setState({ status: "loading" }); setAttempt((value) => value + 1); }}>다시 시도</button></section> : null}
      {state.status === "ready" && state.applications.length === 0 ? <p className="admin-state">대기 중인 신청이 없습니다.</p> : null}
      {state.status === "ready" && state.applications.length > 0 ? <ul className="admin-card-list" aria-label="대기 중인 교사 신청">
        {state.applications.map((application) => <li key={application.id} className="admin-card admin-card--application">
          <div><strong>{application.name}</strong><p>{application.email}</p><p>{application.phone}</p></div>
          <div className="button-row">
            <button className="primary-button" type="button" disabled={pendingId === application.id} onClick={() => decide(application, "approved")}>{pendingId === application.id ? "처리 중…" : "승인"}</button>
            <button className="danger-button" type="button" disabled={pendingId === application.id} onClick={() => decide(application, "rejected")}>{pendingId === application.id ? "처리 중…" : "거절"}</button>
          </div>
        </li>)}
      </ul> : null}
    </main>
  );
}
