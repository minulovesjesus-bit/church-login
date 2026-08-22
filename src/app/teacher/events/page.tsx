"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Pagination, PaginationContent, PaginationItem } from "@/components/ui/pagination";
import EventForm, {
  type EventMutationControl,
  type EventSeries,
} from "@/features/events/event-form";
import EventList from "@/features/events/event-list";
import { api, ApiClientError } from "@/lib/api/client";

const PAGE_SIZE = 100;

type EventSeriesPage = {
  items: EventSeries[];
  total: number;
  page: number;
  page_size: number;
};

type ListState =
  | { key: string; status: "loading" }
  | { key: string; status: "ready"; response: EventSeriesPage }
  | { key: string; status: "error"; message: string }
  | { key: string; status: "auth" };

type AuthorizationCode = "AUTH_REQUIRED" | "FORBIDDEN";

function listPath(page: number): `/api/${string}` {
  return `/api/teacher/events?page=${page}&page_size=${PAGE_SIZE}`;
}

export function TeacherEventsManager({ initialPage = 1 }: { initialPage?: number }) {
  const router = useRouter();
  const [page, setPage] = useState(initialPage);
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<ListState>({ key: `${initialPage}:0`, status: "loading" });
  const [selected, setSelected] = useState<EventSeries>();
  const [deletingId, setDeletingId] = useState<string>();
  const [mutationPending, setMutationPending] = useState(false);
  const [mutationError, setMutationError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const mountedRef = useRef(true);
  const terminalAuthRef = useRef(false);
  const authorizationGenerationRef = useRef(0);
  const mutationSequenceRef = useRef(0);
  const activeMutationRef = useRef<number | null>(null);
  const eventListHeadingRef = useRef<HTMLHeadingElement>(null);
  const requestKey = `${page}:${attempt}`;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      authorizationGenerationRef.current += 1;
      activeMutationRef.current = null;
      mutationSequenceRef.current += 1;
    };
  }, []);

  const redirectAuthorization = useCallback((code: AuthorizationCode) => {
    if (!mountedRef.current || terminalAuthRef.current) return;
    terminalAuthRef.current = true;
    authorizationGenerationRef.current += 1;
    activeMutationRef.current = null;
    mutationSequenceRef.current += 1;
    setMutationPending(false);
    setState({ key: "terminal-auth", status: "auth" });
    router.replace(code === "AUTH_REQUIRED" ? "/teacher/login" : "/teacher/apply");
  }, [router]);

  const beginMutation = useCallback((): number | null => {
    if (!mountedRef.current || terminalAuthRef.current || activeMutationRef.current !== null) return null;
    const token = mutationSequenceRef.current + 1;
    mutationSequenceRef.current = token;
    activeMutationRef.current = token;
    setMutationPending(true);
    return token;
  }, []);

  const isMutationCurrent = useCallback((token: number): boolean => (
    mountedRef.current
    && !terminalAuthRef.current
    && activeMutationRef.current === token
  ), []);

  const finishMutation = useCallback((token: number) => {
    if (!mountedRef.current || terminalAuthRef.current || activeMutationRef.current !== token) return;
    activeMutationRef.current = null;
    setMutationPending(false);
  }, []);

  const mutationControl = useMemo<EventMutationControl>(() => ({
    begin: beginMutation,
    isCurrent: isMutationCurrent,
    finish: finishMutation,
  }), [beginMutation, finishMutation, isMutationCurrent]);

  useEffect(() => {
    let active = true;
    const authorizationGeneration = authorizationGenerationRef.current;
    api.get<EventSeriesPage>(listPath(page))
      .then((response) => {
        if (
          active
          && mountedRef.current
          && !terminalAuthRef.current
          && authorizationGenerationRef.current === authorizationGeneration
        ) {
          setState({ key: requestKey, status: "ready", response });
        }
      })
      .catch((caught: unknown) => {
        if (
          !active
          || !mountedRef.current
          || terminalAuthRef.current
          || authorizationGenerationRef.current !== authorizationGeneration
        ) return;
        if (caught instanceof ApiClientError && caught.code === "AUTH_REQUIRED") {
          redirectAuthorization("AUTH_REQUIRED");
          return;
        }
        if (caught instanceof ApiClientError && caught.code === "FORBIDDEN") {
          redirectAuthorization("FORBIDDEN");
          return;
        }
        setState({
          key: requestKey,
          status: "error",
          message: caught instanceof ApiClientError ? caught.message : "일정 목록을 불러오지 못했습니다.",
        });
      });
    return () => {
      active = false;
    };
  }, [attempt, page, redirectAuthorization, requestKey]);

  if (state.status === "auth") {
    return <main className="teacher-events-shell"><p role="status">권한 확인 페이지로 이동하고 있습니다.</p></main>;
  }
  const currentState = state.key === requestKey ? state : { key: requestKey, status: "loading" as const };

  function refresh() {
    if (mutationPending || terminalAuthRef.current) return;
    setAttempt((value) => value + 1);
  }

  function handleSaved(action: "created" | "updated") {
    if (terminalAuthRef.current) return;
    setSelected(undefined);
    setMutationError(undefined);
    setNotice(action === "created" ? "일정을 등록했습니다." : "일정 전체를 수정했습니다.");
    refresh();
  }

  async function deleteEvent(event: EventSeries) {
    if (mutationPending || deletingId || terminalAuthRef.current) return;
    const mutationToken = beginMutation();
    if (mutationToken === null) return;

    setDeletingId(event.id);
    setMutationError(undefined);
    setNotice(undefined);
    try {
      await api.delete(`/api/teacher/events/${event.id}`);
      if (!isMutationCurrent(mutationToken)) return;
      setSelected((current) => current?.id === event.id ? undefined : current);
      setNotice("일정 전체를 삭제했습니다.");
      const response = currentState.status === "ready" ? currentState.response : undefined;
      if (page > 1 && response?.items.length === 1) {
        setPage((value) => Math.max(1, value - 1));
      } else {
        refresh();
      }
    } catch (caught: unknown) {
      if (!isMutationCurrent(mutationToken)) return;
      if (caught instanceof ApiClientError && caught.code === "AUTH_REQUIRED") {
        redirectAuthorization("AUTH_REQUIRED");
        return;
      }
      if (caught instanceof ApiClientError && caught.code === "FORBIDDEN") {
        redirectAuthorization("FORBIDDEN");
        return;
      }
      setMutationError(caught instanceof ApiClientError ? caught.message : "일정을 삭제하지 못했습니다.");
    } finally {
      if (isMutationCurrent(mutationToken)) setDeletingId(undefined);
      finishMutation(mutationToken);
    }
  }

  const response = currentState.status === "ready" ? currentState.response : undefined;
  const totalPages = response ? Math.max(1, Math.ceil(response.total / response.page_size)) : 1;

  return (
    <main className="teacher-events-shell">
      <header className="teacher-events-header">
        <div>
          <h1>일정 관리</h1>
          <p>한국 시간 기준으로 한 번 또는 매주 반복되는 일정을 관리하세요.</p>
        </div>
        <Button variant="outline" type="button" disabled={mutationPending} onClick={refresh}>새로고침</Button>
      </header>

      {notice ? <Alert className="teacher-events-notice" role="status"><AlertDescription>{notice}</AlertDescription></Alert> : null}
      {mutationError ? <Alert className="teacher-events-notice" variant="destructive"><AlertDescription>{mutationError}</AlertDescription></Alert> : null}

      <div className="teacher-events-layout">
        <EventForm
          key={selected?.id ?? "new-event"}
          event={selected}
          onSaved={handleSaved}
          onCancel={() => setSelected(undefined)}
          onAuthorizationError={redirectAuthorization}
          mutationControl={mutationControl}
          mutationPending={mutationPending}
        />

        <Card className="teacher-event-list-card" aria-labelledby="event-list-title">
          <CardHeader className="teacher-event-section-heading">
            <CardTitle>
              <h2
                ref={eventListHeadingRef}
                id="event-list-title"
                tabIndex={-1}
                className="rounded-sm outline-none focus-visible:ring-3 focus-visible:ring-ring"
              >
                등록된 일정
              </h2>
            </CardTitle>
            {response ? <span>총 {response.total}건</span> : null}
          </CardHeader>
          <CardContent className="teacher-event-list-content">
          {currentState.status === "loading" ? <p className="teacher-event-loading" role="status">일정 목록을 불러오고 있습니다.</p> : null}
          {currentState.status === "error" ? (
            <Alert className="teacher-event-error" variant="destructive">
              <AlertDescription>{currentState.message}</AlertDescription>
              <Button type="button" onClick={refresh}>다시 시도</Button>
            </Alert>
          ) : null}
          {response ? (
            <EventList
              events={response.items}
              deletingId={deletingId}
              disabled={mutationPending}
              focusAfterDeleteRef={eventListHeadingRef}
              onEdit={setSelected}
              onDelete={(event) => void deleteEvent(event)}
            />
          ) : null}
          </CardContent>
          {response ? (
            <CardFooter>
              <Pagination className="teacher-event-pagination" aria-label="일정 페이지">
                <PaginationContent>
                  <PaginationItem>
                    <Button variant="outline" type="button" disabled={mutationPending || page <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))}>이전 페이지</Button>
                  </PaginationItem>
                  <PaginationItem><span>{page} / {totalPages} 페이지 · 총 {response.total}건</span></PaginationItem>
                  <PaginationItem>
                    <Button variant="outline" type="button" disabled={mutationPending || page >= totalPages} onClick={() => setPage((value) => Math.min(totalPages, value + 1))}>다음 페이지</Button>
                  </PaginationItem>
                </PaginationContent>
              </Pagination>
            </CardFooter>
          ) : null}
        </Card>
      </div>
    </main>
  );
}

export default function TeacherEventsPage() {
  return <TeacherEventsManager />;
}
