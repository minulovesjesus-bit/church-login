"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import EventForm, { type EventSeries } from "@/features/events/event-form";
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
  const [mutationError, setMutationError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const requestKey = `${page}:${attempt}`;

  const redirectAuthorization = useCallback((code: AuthorizationCode) => {
    setState({ key: requestKey, status: "auth" });
    router.replace(code === "AUTH_REQUIRED" ? "/teacher/login" : "/teacher/apply");
  }, [requestKey, router]);

  useEffect(() => {
    let active = true;
    api.get<EventSeriesPage>(listPath(page))
      .then((response) => {
        if (active) setState({ key: requestKey, status: "ready", response });
      })
      .catch((caught: unknown) => {
        if (!active) return;
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

  const currentState = state.key === requestKey ? state : { key: requestKey, status: "loading" as const };
  if (currentState.status === "auth") {
    return <main className="teacher-events-shell"><p role="status">권한 확인 페이지로 이동하고 있습니다.</p></main>;
  }

  function refresh() {
    setAttempt((value) => value + 1);
  }

  function handleSaved(action: "created" | "updated") {
    setSelected(undefined);
    setMutationError(undefined);
    setNotice(action === "created" ? "일정을 등록했습니다." : "일정 전체를 수정했습니다.");
    refresh();
  }

  async function deleteEvent(event: EventSeries) {
    if (deletingId) return;
    const confirmation = event.repeat_weekly
      ? `${event.title} 반복 일정 전체를 삭제하시겠습니까?`
      : `${event.title} 일정을 삭제하시겠습니까?`;
    if (!window.confirm(confirmation)) return;

    setDeletingId(event.id);
    setMutationError(undefined);
    setNotice(undefined);
    try {
      await api.delete(`/api/teacher/events/${event.id}`);
      setSelected((current) => current?.id === event.id ? undefined : current);
      setNotice("일정 전체를 삭제했습니다.");
      const response = currentState.status === "ready" ? currentState.response : undefined;
      if (page > 1 && response?.items.length === 1) {
        setPage((value) => Math.max(1, value - 1));
      } else {
        refresh();
      }
    } catch (caught: unknown) {
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
      setDeletingId(undefined);
    }
  }

  const response = currentState.status === "ready" ? currentState.response : undefined;
  const totalPages = response ? Math.max(1, Math.ceil(response.total / response.page_size)) : 1;

  return (
    <main className="teacher-events-shell">
      <header className="teacher-events-header">
        <div>
          <p className="eyebrow">Teacher events</p>
          <h1>일정 관리</h1>
          <p>한국 시간 기준으로 한 번 또는 매주 반복되는 일정을 관리하세요.</p>
        </div>
        <button className="secondary-button" type="button" onClick={refresh}>새로고침</button>
      </header>

      {notice ? <p className="notice teacher-events-notice" role="status">{notice}</p> : null}
      {mutationError ? <p className="inline-alert teacher-events-notice" role="alert">{mutationError}</p> : null}

      <div className="teacher-events-layout">
        <EventForm
          key={selected?.id ?? "new-event"}
          event={selected}
          onSaved={handleSaved}
          onCancel={() => setSelected(undefined)}
          onAuthorizationError={redirectAuthorization}
        />

        <section className="teacher-event-list-card" aria-labelledby="event-list-title">
          <div className="teacher-event-section-heading">
            <div>
              <p className="eyebrow">All series</p>
              <h2 id="event-list-title">등록된 일정</h2>
            </div>
            {response ? <span>총 {response.total}건</span> : null}
          </div>
          {currentState.status === "loading" ? <p className="teacher-event-loading" role="status">일정 목록을 불러오고 있습니다.</p> : null}
          {currentState.status === "error" ? (
            <div className="teacher-event-error" role="alert">
              <p>{currentState.message}</p>
              <button className="primary-button" type="button" onClick={refresh}>다시 시도</button>
            </div>
          ) : null}
          {response ? <EventList events={response.items} deletingId={deletingId} onEdit={setSelected} onDelete={(event) => void deleteEvent(event)} /> : null}
          {response ? (
            <nav className="teacher-event-pagination" aria-label="일정 페이지">
              <button className="secondary-button" type="button" disabled={page <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))}>이전 페이지</button>
              <span>{page} / {totalPages} 페이지 · 총 {response.total}건</span>
              <button className="secondary-button" type="button" disabled={page >= totalPages} onClick={() => setPage((value) => Math.min(totalPages, value + 1))}>다음 페이지</button>
            </nav>
          ) : null}
        </section>
      </div>
    </main>
  );
}

export default function TeacherEventsPage() {
  return <TeacherEventsManager />;
}
