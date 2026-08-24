"use client";

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
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
import { Empty, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { api, ApiClientError } from "@/lib/api/client";

type StaffRole = "teacher" | "admin";
type StaffMember = { user_id: string; email: string; name: string; phone: string | null; role: StaffRole };
type ListState =
  | { status: "loading" }
  | { status: "ready"; staff: StaffMember[] }
  | { status: "error"; message: string }
  | { status: "auth" };

function authorizationDestination(error: unknown): string | undefined {
  if (!(error instanceof ApiClientError)) return undefined;
  if (error.code === "AUTH_REQUIRED") return "/login";
  if (error.code === "FORBIDDEN") return "/student";
  return undefined;
}

function roleAction(member: StaffMember): string {
  return member.role === "admin" ? "교사로 변경" : "관리자로 승격";
}

type RoleChangeDialogProps = {
  member: StaffMember;
  disabled: boolean;
  pending: boolean;
  focusFallbackRef: RefObject<HTMLHeadingElement | null>;
  onChangeRole: (member: StaffMember) => void;
};

function RoleChangeDialog({ member, disabled, pending, focusFallbackRef, onChangeRole }: RoleChangeDialogProps) {
  const confirmedRef = useRef(false);
  const promoting = member.role === "teacher";
  const action = roleAction(member);
  const title = promoting ? `${member.name} 님 관리자 승격` : `${member.name} 님 교사 변경`;
  const description = promoting
    ? `${member.name} 님을 관리자로 승격하시겠습니까? 관리자 전용 기능을 사용할 수 있게 됩니다.`
    : `${member.name} 님을 교사로 변경하시겠습니까? 관리자 전용 기능을 더 이상 사용할 수 없습니다.`;

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button
          variant={member.role === "admin" ? "destructive" : "default"}
          type="button"
          disabled={disabled}
          aria-label={pending ? `${member.name} 님 역할 변경 중…` : `${member.name} 님 ${action}`}
        >
          {pending ? "변경 중…" : action}
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
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>취소</AlertDialogCancel>
          <AlertDialogAction
            variant={member.role === "admin" ? "destructive" : "default"}
            aria-label={`${title} 확인`}
            onClick={() => {
              confirmedRef.current = true;
              onChangeRole(member);
            }}
          >
            {action}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export default function StaffPage() {
  const router = useRouter();
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<ListState>({ status: "loading" });
  const [pendingId, setPendingId] = useState<string>();
  const [mutationError, setMutationError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const mountedRef = useRef(true);
  const terminalAuthRef = useRef(false);
  const sequenceRef = useRef(0);
  const mutationRef = useRef(false);
  const pageHeadingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      sequenceRef.current += 1;
      mutationRef.current = false;
    };
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

  useEffect(() => {
    let active = true;
    const sequence = sequenceRef.current + 1;
    sequenceRef.current = sequence;
    api.get<StaffMember[]>("/api/admin/staff")
      .then((staff) => {
        if (active && mountedRef.current && !terminalAuthRef.current && sequence === sequenceRef.current) {
          setState({ status: "ready", staff });
        }
      })
      .catch((error) => {
        if (!active || !mountedRef.current || sequence !== sequenceRef.current) return;
        if (terminalAuthorization(error)) return;
        setState({ status: "error", message: error instanceof ApiClientError ? error.message : "교직원 목록을 불러오지 못했습니다." });
      });
    return () => { active = false; };
  }, [attempt, terminalAuthorization]);

  async function changeRole(member: StaffMember) {
    if (mutationRef.current || terminalAuthRef.current) return;
    const nextRole: StaffRole = member.role === "admin" ? "teacher" : "admin";

    mutationRef.current = true;
    setPendingId(member.user_id);
    setMutationError(undefined);
    setNotice(undefined);
    const sequence = sequenceRef.current;
    try {
      const changed = await api.patch<StaffMember>(`/api/admin/staff/${member.user_id}/role`, { role: nextRole });
      if (!mountedRef.current || terminalAuthRef.current || sequence !== sequenceRef.current) return;
      setState((current) => current.status === "ready"
        ? { status: "ready", staff: current.staff.map((item) => item.user_id === changed.user_id ? changed : item) }
        : current);
      setNotice(`${changed.name} 님의 역할을 ${changed.role === "admin" ? "관리자" : "교사"}로 변경했습니다.`);
    } catch (error) {
      if (!mountedRef.current || sequence !== sequenceRef.current) return;
      if (terminalAuthorization(error)) return;
      setMutationError(error instanceof ApiClientError ? error.message : "역할을 변경하지 못했습니다.");
    } finally {
      if (mountedRef.current && !terminalAuthRef.current && sequence === sequenceRef.current) {
        mutationRef.current = false;
        setPendingId(undefined);
      }
    }
  }

  if (state.status === "auth") return null;

  return (
    <main className="admin-page">
      <header className="admin-page__header">
        <p className="eyebrow">Administrator</p>
        <h1 ref={pageHeadingRef} tabIndex={-1}>교직원 역할 관리</h1>
        <p className="supporting-copy">역할 변경은 즉시 적용됩니다. 변경 전에 대상과 역할을 다시 확인해 주세요.</p>
      </header>
      {mutationError ? <Alert variant="destructive"><AlertDescription>{mutationError}</AlertDescription></Alert> : null}
      {notice ? <Alert role="presentation"><AlertDescription role="status">{notice}</AlertDescription></Alert> : null}
      {state.status === "loading" ? <p role="status">교직원 목록을 불러오고 있습니다.</p> : null}
      {state.status === "error" ? (
        <section className="admin-state">
          <Alert variant="destructive"><AlertDescription>{state.message}</AlertDescription></Alert>
          <Button variant="outline" type="button" onClick={() => { setState({ status: "loading" }); setAttempt((value) => value + 1); }}>다시 시도</Button>
        </section>
      ) : null}
      {state.status === "ready" && state.staff.length === 0 ? (
        <Empty className="admin-state"><EmptyHeader><EmptyTitle>등록된 교직원이 없습니다.</EmptyTitle></EmptyHeader></Empty>
      ) : null}
      {state.status === "ready" && state.staff.length > 0 ? (
        <ul className="admin-card-list" aria-label="교직원 역할 목록">
          {state.staff.map((member) => (
            <li key={member.user_id} className="admin-card">
              <div className="admin-card__identity">
                <strong>{member.name}</strong>
                <p>{member.email}</p>
                {member.phone ? <p><span className="sr-only">연락처 </span><span>{member.phone}</span></p> : null}
              </div>
              <Badge
                variant={member.role === "admin" ? "default" : "secondary"}
                className={`admin-status admin-status--${member.role}`}
              >
                {member.role === "admin" ? "관리자" : "교사"}
              </Badge>
              <RoleChangeDialog
                member={member}
                disabled={Boolean(pendingId)}
                pending={pendingId === member.user_id}
                focusFallbackRef={pageHeadingRef}
                onChangeRole={(target) => { void changeRole(target); }}
              />
            </li>
          ))}
        </ul>
      ) : null}
    </main>
  );
}
