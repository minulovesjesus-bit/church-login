"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { api, ApiClientError } from "@/lib/api/client";

type KioskSession = { session_id: string; created_at: string; last_seen_at: string; refresh_expires_at: string; revoked_at: string | null };
type KioskSessionPage = { items: KioskSession[]; next_cursor: string | null; page_size: number };
type ReadyState = { status: "ready"; sessions: KioskSession[]; nextCursor: string | null; pageCount: number };
type ListState =
  | { status: "loading" }
  | ReadyState
  | { status: "error"; message: string }
  | { status: "auth" };
type SessionState = "active" | "expired" | "revoked";

const PAGE_SIZE = 100;
const seoulFormatter = new Intl.DateTimeFormat("ko-KR", {
  timeZone: "Asia/Seoul", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "2-digit",
});

export function formatSeoulTimestamp(value: string): string {
  return seoulFormatter.format(new Date(value));
}

function sessionState(session: KioskSession, now: number): SessionState {
  if (session.revoked_at) return "revoked";
  return new Date(session.refresh_expires_at).getTime() <= now ? "expired" : "active";
}

function authorizationDestination(error: unknown): string | undefined {
  if (!(error instanceof ApiClientError)) return undefined;
  if (error.code === "AUTH_REQUIRED") return "/teacher/login";
  if (error.code === "FORBIDDEN") return "/teacher";
  return undefined;
}

function pagePath(cursor?: string): `/api/${string}` {
  const query = new URLSearchParams({ page_size: String(PAGE_SIZE) });
  if (cursor) query.set("cursor", cursor);
  return `/api/admin/kiosk-sessions?${query.toString()}`;
}

function appendUnique(existing: KioskSession[], incoming: KioskSession[]): KioskSession[] {
  const seen = new Set(existing.map((session) => session.session_id));
  const unique = [...existing];
  for (const session of incoming) {
    if (seen.has(session.session_id)) continue;
    seen.add(session.session_id);
    unique.push(session);
  }
  return unique;
}

export default function KioskSessionsPage() {
  const router = useRouter();
  const [state, setState] = useState<ListState>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [pendingId, setPendingId] = useState<string>();
  const [loadingMore, setLoadingMore] = useState(false);
  const [pageError, setPageError] = useState<string>();
  const [mutationError, setMutationError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [now, setNow] = useState(() => Date.now());
  const mountedRef = useRef(true);
  const terminalAuthRef = useRef(false);
  const sequenceRef = useRef(0);
  const operationRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; sequenceRef.current += 1; operationRef.current = false; };
  }, []);

  const terminalAuthorization = useCallback((error: unknown) => {
    const destination = authorizationDestination(error);
    if (!destination || !mountedRef.current || terminalAuthRef.current) return false;
    terminalAuthRef.current = true;
    sequenceRef.current += 1;
    operationRef.current = false;
    setPendingId(undefined);
    setLoadingMore(false);
    setPageError(undefined);
    setState({ status: "auth" });
    router.replace(destination);
    return true;
  }, [router]);

  const fetchPage = useCallback((cursor?: string) => (
    api.get<KioskSessionPage>(pagePath(cursor))
  ), []);

  const loadSessions = useCallback(async () => {
    const sequence = sequenceRef.current + 1;
    sequenceRef.current = sequence;
    try {
      const page = await fetchPage();
      if (mountedRef.current && !terminalAuthRef.current && sequence === sequenceRef.current) {
        setNow(Date.now());
        setPageError(undefined);
        setState({ status: "ready", sessions: page.items, nextCursor: page.next_cursor, pageCount: 1 });
      }
    } catch (error) {
      if (!mountedRef.current || sequence !== sequenceRef.current) return;
      if (terminalAuthorization(error)) return;
      setState({ status: "error", message: error instanceof ApiClientError ? error.message : "기기 세션을 불러오지 못했습니다." });
    }
  }, [fetchPage, terminalAuthorization]);

  useEffect(() => {
    queueMicrotask(() => { void loadSessions(); });
  }, [attempt, loadSessions]);

  async function loadMoreSessions(ready: ReadyState) {
    if (!ready.nextCursor || operationRef.current || terminalAuthRef.current) return;
    operationRef.current = true;
    setLoadingMore(true);
    setPageError(undefined);
    const sequence = sequenceRef.current;
    try {
      const page = await fetchPage(ready.nextCursor);
      if (!mountedRef.current || terminalAuthRef.current || sequence !== sequenceRef.current) return;
      setNow(Date.now());
      setState((current) => current.status === "ready" ? {
        status: "ready",
        sessions: appendUnique(current.sessions, page.items),
        nextCursor: page.next_cursor,
        pageCount: current.pageCount + 1,
      } : current);
    } catch (error) {
      if (!mountedRef.current || sequence !== sequenceRef.current) return;
      if (terminalAuthorization(error)) return;
      setPageError(error instanceof ApiClientError ? error.message : "다음 기기 세션을 불러오지 못했습니다.");
    } finally {
      if (mountedRef.current && !terminalAuthRef.current && sequence === sequenceRef.current) {
        operationRef.current = false;
        setLoadingMore(false);
      }
    }
  }

  async function reloadLoadedPages(pageCount: number): Promise<ReadyState> {
    let page = await fetchPage();
    let sessions = page.items;
    let loadedPages = 1;
    while (loadedPages < pageCount && page.next_cursor) {
      page = await fetchPage(page.next_cursor);
      sessions = appendUnique(sessions, page.items);
      loadedPages += 1;
    }
    return { status: "ready", sessions, nextCursor: page.next_cursor, pageCount: loadedPages };
  }

  async function revoke(session: KioskSession, ready: ReadyState) {
    if (operationRef.current || terminalAuthRef.current) return;
    if (!window.confirm(`${session.session_id} 기기 세션을 해지하시겠습니까? 즉시 QR 발급과 갱신이 중단됩니다.`)) return;
    operationRef.current = true;
    setPendingId(session.session_id);
    setMutationError(undefined);
    setPageError(undefined);
    setNotice(undefined);
    const sequence = sequenceRef.current;
    try {
      await api.delete(`/api/admin/kiosk-sessions/${session.session_id}`);
      if (!mountedRef.current || terminalAuthRef.current || sequence !== sequenceRef.current) return;
      const revokedAt = new Date().toISOString();
      setState((current) => current.status === "ready" ? {
        ...current,
        sessions: current.sessions.map((item) => item.session_id === session.session_id ? { ...item, revoked_at: revokedAt } : item),
      } : current);
      setNow(Date.parse(revokedAt));
      setNotice(`${session.session_id} 기기 세션을 해지했습니다.`);
      try {
        const refreshed = await reloadLoadedPages(ready.pageCount);
        if (mountedRef.current && !terminalAuthRef.current && sequence === sequenceRef.current) {
          setState(refreshed);
        }
      } catch (error) {
        if (!mountedRef.current || sequence !== sequenceRef.current) return;
        if (terminalAuthorization(error)) return;
        setMutationError("세션은 해지했지만 목록을 새로고침하지 못했습니다. 다시 접속하면 최신 상태를 확인할 수 있습니다.");
      }
    } catch (error) {
      if (!mountedRef.current || terminalAuthRef.current) return;
      if (terminalAuthorization(error)) return;
      setMutationError(error instanceof ApiClientError ? error.message : "기기 세션을 해지하지 못했습니다.");
    } finally {
      if (mountedRef.current && !terminalAuthRef.current && sequence === sequenceRef.current) {
        operationRef.current = false;
        setPendingId(undefined);
      }
    }
  }

  if (state.status === "auth") return null;
  const competingAction = Boolean(pendingId) || loadingMore;
  return (
    <main className="admin-page">
      <header className="admin-page__header">
        <p className="eyebrow">Administrator</p><h1>기기 세션 관리</h1>
        <p className="supporting-copy">교회 공용 기기의 식별자와 최근 사용 상태를 확인하고 즉시 해지할 수 있습니다.</p>
      </header>
      {mutationError ? <p className="inline-alert" role="alert">{mutationError}</p> : null}
      {notice ? <p className="notice" role="status">{notice}</p> : null}
      {state.status === "loading" ? <p role="status">기기 세션을 불러오고 있습니다.</p> : null}
      {state.status === "error" ? <section className="admin-state"><p className="inline-alert" role="alert">{state.message}</p><button className="secondary-button" type="button" onClick={() => { setState({ status: "loading" }); setAttempt((value) => value + 1); }}>다시 시도</button></section> : null}
      {state.status === "ready" && state.sessions.length === 0 ? <p className="admin-state">등록된 기기 세션이 없습니다.</p> : null}
      {state.status === "ready" && state.sessions.length > 0 ? (
        <>
          <ul className="admin-card-list" aria-label="기기 세션 목록">
            {state.sessions.map((session) => {
              const currentState = sessionState(session, now);
              const label = currentState === "active" ? "활성" : currentState === "expired" ? "만료" : "해지됨";
              return <li key={session.session_id} className="admin-card admin-card--kiosk">
                <div className="admin-session-id"><span>기기 세션</span><strong>{session.session_id}</strong></div>
                <span className={`admin-status admin-status--${currentState}`}>{label}</span>
                <dl className="admin-session-times">
                  <div><dt>생성</dt><dd><time dateTime={session.created_at}>{formatSeoulTimestamp(session.created_at)}</time></dd></div>
                  <div><dt>최근 사용</dt><dd><time dateTime={session.last_seen_at}>{formatSeoulTimestamp(session.last_seen_at)}</time></dd></div>
                  <div><dt>만료</dt><dd><time dateTime={session.refresh_expires_at}>{formatSeoulTimestamp(session.refresh_expires_at)}</time></dd></div>
                  <div><dt>해지</dt><dd>{session.revoked_at ? <time dateTime={session.revoked_at}>{formatSeoulTimestamp(session.revoked_at)}</time> : "-"}</dd></div>
                </dl>
                <button className="danger-button" type="button" disabled={currentState === "revoked" || competingAction} onClick={() => revoke(session, state)}>
                  {currentState === "revoked" ? "해지 완료" : pendingId === session.session_id ? "해지 중…" : "세션 해지"}
                </button>
              </li>;
            })}
          </ul>
          {pageError ? <p className="inline-alert" role="alert">{pageError}</p> : null}
          {state.nextCursor ? <button className="secondary-button" type="button" disabled={competingAction} onClick={() => loadMoreSessions(state)}>{loadingMore ? "불러오는 중…" : "더 보기"}</button> : null}
        </>
      ) : null}
    </main>
  );
}
