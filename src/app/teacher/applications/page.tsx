"use client";

import { FormEvent, useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { useRouter } from "next/navigation";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Empty, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";
import { api, ApiClientError } from "@/lib/api/client";

type Application = { id: string; user_id: string; email: string; name: string; phone: string; status: "pending" };
type ListState =
  | { status: "loading" }
  | { status: "ready"; applications: Application[] }
  | { status: "error"; message: string }
  | { status: "auth" };
type RejectionDraft = { application: Application; reason: string };
type ReconciliationState =
  | { status: "idle" }
  | { status: "checking"; conflictMessage: string }
  | { status: "error"; conflictMessage: string; message: string }
  | { status: "conflict"; conflictMessage: string };

function authorizationDestination(error: unknown): string | undefined {
  if (!(error instanceof ApiClientError)) return undefined;
  if (error.code === "AUTH_REQUIRED") return "/teacher/login";
  if (error.code === "FORBIDDEN") return "/teacher";
  return undefined;
}

type ApprovalDialogProps = {
  application: Application;
  disabled: boolean;
  pending: boolean;
  focusFallbackRef: RefObject<HTMLHeadingElement | null>;
  onApprove: (application: Application) => void;
};

function ApprovalDialog({ application, disabled, pending, focusFallbackRef, onApprove }: ApprovalDialogProps) {
  const confirmedRef = useRef(false);

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button
          type="button"
          disabled={disabled}
          aria-label={pending ? `${application.name} 님 승인 처리 중…` : `${application.name} 님 승인`}
        >
          {pending ? "처리 중…" : "승인"}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent
        onCloseAutoFocus={(event) => {
          if (!confirmedRef.current) return;
          confirmedRef.current = false;
          event.preventDefault();
          queueMicrotask(() => focusFallbackRef.current?.focus());
        }}
      >
        <AlertDialogHeader>
          <AlertDialogTitle>{application.name} 님 교사 승인</AlertDialogTitle>
          <AlertDialogDescription>
            {application.name} 님을 교사로 승인하시겠습니까? 즉시 교사 기능을 사용할 수 있게 됩니다.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>취소</AlertDialogCancel>
          <AlertDialogAction
            aria-label={`${application.name} 님 승인 확인`}
            onClick={() => {
              confirmedRef.current = true;
              onApprove(application);
            }}
          >
            승인
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export default function TeacherApplicationsPage() {
  const router = useRouter();
  const [state, setState] = useState<ListState>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [pendingId, setPendingId] = useState<string>();
  const [mutationError, setMutationError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [rejection, setRejection] = useState<RejectionDraft>();
  const [reconciliation, setReconciliation] = useState<ReconciliationState>({ status: "idle" });
  const mountedRef = useRef(true);
  const terminalAuthRef = useRef(false);
  const sequenceRef = useRef(0);
  const mutationRef = useRef(false);
  const reconciliationRef = useRef(false);
  const pageHeadingRef = useRef<HTMLHeadingElement>(null);
  const rejectionOpenerRef = useRef<HTMLButtonElement | null>(null);
  const rejectionCommittedRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; sequenceRef.current += 1; mutationRef.current = false; reconciliationRef.current = false; };
  }, []);

  const terminalAuthorization = useCallback((error: unknown) => {
    const destination = authorizationDestination(error);
    if (!destination || !mountedRef.current || terminalAuthRef.current) return false;
    terminalAuthRef.current = true;
    sequenceRef.current += 1;
    mutationRef.current = false;
    reconciliationRef.current = false;
    setPendingId(undefined);
    setMutationError(undefined);
    setReconciliation({ status: "idle" });
    setRejection(undefined);
    setState({ status: "auth" });
    router.replace(destination);
    return true;
  }, [router]);

  const loadApplications = useCallback(async () => {
    const sequence = sequenceRef.current + 1;
    sequenceRef.current = sequence;
    try {
      const applications = await api.get<Application[]>("/api/admin/teacher-applications");
      if (!mountedRef.current || terminalAuthRef.current || sequence !== sequenceRef.current) return undefined;
      setState({ status: "ready", applications });
      setRejection((current) => current && applications.some((item) => item.id === current.application.id) ? current : undefined);
      return applications;
    } catch (error) {
      if (!mountedRef.current || sequence !== sequenceRef.current) return undefined;
      if (terminalAuthorization(error)) return undefined;
      setState({ status: "error", message: error instanceof ApiClientError ? error.message : "신청 목록을 불러오지 못했습니다." });
      return undefined;
    }
  }, [terminalAuthorization]);

  useEffect(() => {
    queueMicrotask(() => { void loadApplications(); });
  }, [attempt, loadApplications]);

  async function approve(application: Application) {
    if (mutationRef.current || terminalAuthRef.current || rejection) return;

    mutationRef.current = true;
    setPendingId(application.id);
    setMutationError(undefined);
    setNotice(undefined);
    const sequence = sequenceRef.current;
    try {
      await api.post(`/api/admin/teacher-applications/${application.id}/approve`, {});
      if (!mountedRef.current || terminalAuthRef.current || sequence !== sequenceRef.current) return;
      setState((current) => current.status === "ready"
        ? { status: "ready", applications: current.applications.filter((item) => item.id !== application.id) }
        : current);
      setNotice(`${application.name} 님의 신청을 승인했습니다.`);
    } catch (error) {
      if (!mountedRef.current || terminalAuthRef.current) return;
      if (terminalAuthorization(error)) return;
      if (error instanceof ApiClientError && error.code === "APPLICATION_ALREADY_REVIEWED") {
        const applications = await loadApplications();
        if (applications?.some((item) => item.id === application.id)) {
          setMutationError(error.message);
        }
        return;
      }
      setMutationError(error instanceof ApiClientError ? error.message : "신청을 처리하지 못했습니다.");
    } finally {
      if (mountedRef.current && !terminalAuthRef.current) { mutationRef.current = false; setPendingId(undefined); }
    }
  }

  function openRejection(application: Application, opener: HTMLButtonElement) {
    if (mutationRef.current || terminalAuthRef.current || rejection) return;
    rejectionOpenerRef.current = opener;
    rejectionCommittedRef.current = false;
    setMutationError(undefined);
    setNotice(undefined);
    setReconciliation({ status: "idle" });
    setRejection({ application, reason: "" });
  }

  function cancelRejection() {
    if (mutationRef.current || reconciliationRef.current) return;
    rejectionCommittedRef.current = false;
    setMutationError(undefined);
    setReconciliation({ status: "idle" });
    setRejection(undefined);
  }

  async function reconcileRejection(application: Application, conflictMessage: string) {
    if (reconciliationRef.current || terminalAuthRef.current) return;
    reconciliationRef.current = true;
    setReconciliation({ status: "checking", conflictMessage });
    try {
      const applications = await api.get<Application[]>("/api/admin/teacher-applications");
      if (!mountedRef.current || terminalAuthRef.current) return;
      setState({ status: "ready", applications });
      if (applications.some((item) => item.id === application.id)) {
        setReconciliation({ status: "conflict", conflictMessage });
        return;
      }
      setMutationError(undefined);
      setReconciliation({ status: "idle" });
      setRejection(undefined);
      setNotice("이미 처리된 신청을 목록에서 정리했습니다.");
    } catch (error) {
      if (!mountedRef.current || terminalAuthRef.current) return;
      if (terminalAuthorization(error)) return;
      setReconciliation({
        status: "error",
        conflictMessage,
        message: error instanceof ApiClientError ? error.message : "신청 상태를 확인하지 못했습니다.",
      });
    } finally {
      if (mountedRef.current && !terminalAuthRef.current) reconciliationRef.current = false;
    }
  }

  async function reject(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!rejection || mutationRef.current || terminalAuthRef.current) return;

    const reason = rejection.reason.trim();
    if (!reason) { setMutationError("거절 사유를 입력해 주세요."); return; }
    if (reason.length > 500) { setMutationError("거절 사유는 500자 이하여야 합니다."); return; }

    const application = rejection.application;
    rejectionCommittedRef.current = true;
    mutationRef.current = true;
    setPendingId(application.id);
    setMutationError(undefined);
    setNotice(undefined);
    const sequence = sequenceRef.current;
    try {
      await api.post(`/api/admin/teacher-applications/${application.id}/reject`, { rejection_reason: reason });
      if (!mountedRef.current || terminalAuthRef.current || sequence !== sequenceRef.current) return;
      setState((current) => current.status === "ready"
        ? { status: "ready", applications: current.applications.filter((item) => item.id !== application.id) }
        : current);
      setReconciliation({ status: "idle" });
      setRejection(undefined);
      setNotice(`${application.name} 님의 신청을 거절했습니다.`);
    } catch (error) {
      if (!mountedRef.current || terminalAuthRef.current) return;
      if (terminalAuthorization(error)) return;
      if (error instanceof ApiClientError && error.code === "APPLICATION_ALREADY_REVIEWED") {
        await reconcileRejection(application, error.message);
        return;
      }
      setMutationError(error instanceof ApiClientError ? error.message : "신청을 처리하지 못했습니다.");
    } finally {
      if (mountedRef.current && !terminalAuthRef.current) { mutationRef.current = false; setPendingId(undefined); }
    }
  }

  if (state.status === "auth") return null;
  const actionsLocked = Boolean(pendingId || rejection);
  const reconciliationPending = reconciliation.status === "checking";
  const reconciliationMessage = reconciliation.status === "error"
    ? reconciliation.message
    : reconciliation.status === "conflict"
      ? reconciliation.conflictMessage
      : undefined;
  const reconciliationConflictMessage = reconciliation.status === "idle" ? undefined : reconciliation.conflictMessage;
  return (
    <main className="admin-page">
      <header className="admin-page__header">
        <p className="eyebrow">Administrator</p>
        <h1 ref={pageHeadingRef} tabIndex={-1}>교사 가입 신청 관리</h1>
        <p className="supporting-copy">신청자의 정보를 확인한 뒤 교사 권한 승인 또는 거절을 결정합니다.</p>
      </header>
      {mutationError && !rejection ? <Alert variant="destructive"><AlertDescription>{mutationError}</AlertDescription></Alert> : null}
      {notice ? <Alert role="presentation"><AlertDescription role="status">{notice}</AlertDescription></Alert> : null}
      {state.status === "loading" ? <p role="status">신청 목록을 불러오고 있습니다.</p> : null}
      {state.status === "error" ? (
        <section className="admin-state">
          <Alert variant="destructive"><AlertDescription>{state.message}</AlertDescription></Alert>
          <Button variant="outline" type="button" onClick={() => { setState({ status: "loading" }); setAttempt((value) => value + 1); }}>다시 시도</Button>
        </section>
      ) : null}
      {state.status === "ready" && state.applications.length === 0 ? (
        <Empty className="admin-state"><EmptyHeader><EmptyTitle>대기 중인 신청이 없습니다.</EmptyTitle></EmptyHeader></Empty>
      ) : null}
      {state.status === "ready" && state.applications.length > 0 ? <ul className="admin-card-list" aria-label="대기 중인 교사 신청">
        {state.applications.map((application) => {
          const pending = pendingId === application.id && !rejection;
          return (
            <li key={application.id} className="admin-card admin-card--application">
              <div className="admin-card__identity">
                <strong>{application.name}</strong>
                <p>{application.email}</p>
                <p>{application.phone}</p>
              </div>
              <Badge variant="secondary" className="admin-status admin-status--pending">승인 대기</Badge>
              <div className="button-row">
                <ApprovalDialog
                  application={application}
                  disabled={actionsLocked}
                  pending={pending}
                  focusFallbackRef={pageHeadingRef}
                  onApprove={(target) => { void approve(target); }}
                />
                <Button
                  variant="destructive"
                  type="button"
                  disabled={actionsLocked}
                  aria-label={pending ? `${application.name} 님 거절 처리 중…` : `${application.name} 님 거절`}
                  onClick={(event) => openRejection(application, event.currentTarget)}
                >
                  {pending ? "처리 중…" : "거절"}
                </Button>
              </div>
            </li>
          );
        })}
      </ul> : null}
      {rejection ? (
        <Dialog open onOpenChange={(open) => { if (!open) cancelRejection(); }}>
          <DialogContent
            className="admin-dialog"
            showCloseButton={false}
            onCloseAutoFocus={(event) => {
              event.preventDefault();
              const opener = rejectionOpenerRef.current;
              const target = !rejectionCommittedRef.current && opener?.isConnected && !opener.disabled
                ? opener
                : pageHeadingRef.current;
              rejectionCommittedRef.current = false;
              rejectionOpenerRef.current = null;
              queueMicrotask(() => target?.focus());
            }}
          >
            <form onSubmit={reject}>
              <DialogHeader>
                <DialogTitle>{rejection.application.name} 님 신청 거절</DialogTitle>
                <DialogDescription>{rejection.application.name} 님의 교사 신청을 거절합니다. 신청자는 아래 사유를 확인합니다.</DialogDescription>
              </DialogHeader>
              <FieldGroup>
                <Field data-invalid={Boolean(mutationError)}>
                  <FieldLabel htmlFor="rejection-reason">거절 사유</FieldLabel>
                  <Textarea
                    id="rejection-reason"
                    autoFocus
                    value={rejection.reason}
                    maxLength={500}
                    aria-invalid={Boolean(mutationError)}
                    aria-describedby={[
                      "rejection-count",
                      mutationError ? "rejection-error" : undefined,
                      reconciliationPending ? "reconciliation-status" : undefined,
                      reconciliationMessage ? "reconciliation-message" : undefined,
                    ].filter(Boolean).join(" ")}
                    disabled={pendingId === rejection.application.id || reconciliationPending}
                    onChange={(event) => {
                      setMutationError(undefined);
                      setRejection((current) => current ? { ...current, reason: event.target.value } : current);
                    }}
                  />
                  <FieldDescription id="rejection-count" className="admin-dialog__count">{rejection.reason.length}/500자</FieldDescription>
                </Field>
              </FieldGroup>
              {mutationError ? <Alert id="rejection-error" variant="destructive"><AlertDescription>{mutationError}</AlertDescription></Alert> : null}
              {reconciliationPending ? <p id="reconciliation-status" role="status">신청 상태를 확인하고 있습니다.</p> : null}
              {reconciliationMessage ? <Alert id="reconciliation-message" variant="destructive"><AlertDescription>{reconciliationMessage}</AlertDescription></Alert> : null}
              <DialogFooter>
                <Button type="button" variant="outline" disabled={pendingId === rejection.application.id || reconciliationPending} onClick={cancelRejection}>거절 취소</Button>
                {reconciliation.status === "idle" ? (
                  <Button variant="destructive" type="submit" disabled={pendingId === rejection.application.id}>
                    {pendingId === rejection.application.id ? "거절 처리 중…" : `${rejection.application.name} 님 신청 거절 확정`}
                  </Button>
                ) : (
                  <Button
                    variant="outline"
                    type="button"
                    disabled={reconciliationPending}
                    onClick={() => {
                      if (reconciliationConflictMessage) void reconcileRejection(rejection.application, reconciliationConflictMessage);
                    }}
                  >
                    {reconciliationPending ? "신청 상태 확인 중…" : "신청 상태 다시 확인"}
                  </Button>
                )}
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      ) : null}
    </main>
  );
}
