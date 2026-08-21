"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import StudentCards from "@/features/students/student-cards";
import StudentEditor, { type StudentUpdateCommand } from "@/features/students/student-editor";
import StudentTable, {
  calculateInternationalAge,
  type TeacherStudent,
} from "@/features/students/student-table";
import { api, ApiClientError } from "@/lib/api/client";

export { calculateInternationalAge };

const PAGE_SIZE = 50;
const MAX_CURSOR_LENGTH = 2048;
type StatisticsFilter = "all" | "included" | "excluded";
type AuthorizationCode = "AUTH_REQUIRED" | "FORBIDDEN";

type StudentPage = {
  items: TeacherStudent[];
  next_cursor: string | null;
  page_size: number;
};

type UrlState = {
  query: string;
  statistics: StatisticsFilter;
  cursor?: string;
};

type ListState =
  | { key: string; status: "loading" }
  | { key: string; status: "ready"; response: StudentPage }
  | { key: string; status: "error"; message: string }
  | { key: string; status: "auth" };

function singleValue(params: URLSearchParams, name: string): string | undefined {
  const values = params.getAll(name);
  return values.length === 1 ? values[0] : undefined;
}

function normalizeWhitespace(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function normalizeUrlState(params: URLSearchParams, initialSearch = ""): UrlState {
  const rawQuery = singleValue(params, "query");
  const candidateQuery = rawQuery === undefined ? initialSearch : rawQuery;
  const normalizedQuery = normalizeWhitespace(candidateQuery);
  const query = normalizedQuery.length <= 80 ? normalizedQuery : "";
  const rawStatistics = singleValue(params, "statistics");
  const statistics: StatisticsFilter = rawStatistics === "included" || rawStatistics === "excluded"
    ? rawStatistics
    : "all";
  const rawCursor = singleValue(params, "cursor");
  const cursor = rawCursor && rawCursor.length <= MAX_CURSOR_LENGTH ? rawCursor : undefined;
  return { query, statistics, cursor };
}

function urlParams(state: UrlState, includePageSize = false): URLSearchParams {
  const params = new URLSearchParams();
  if (state.query) params.set("query", state.query);
  params.set("statistics", state.statistics);
  if (state.cursor) params.set("cursor", state.cursor);
  if (includePageSize) params.set("page_size", String(PAGE_SIZE));
  return params;
}

function apiPath(state: UrlState): `/api/${string}` {
  return `/api/teacher/students?${urlParams(state, true).toString()}`;
}

export function TeacherStudentsManager({ initialSearch = "" }: { initialSearch?: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const rawSearch = searchParams.toString();
  const urlState = useMemo(
    () => normalizeUrlState(new URLSearchParams(rawSearch), initialSearch),
    [initialSearch, rawSearch],
  );
  const canonicalSearch = urlParams(urlState).toString();
  const filterKey = `${urlState.query}\0${urlState.statistics}`;
  const [draft, setDraft] = useState({
    key: filterKey,
    query: urlState.query,
    statistics: urlState.statistics,
  });
  const activeDraft = draft.key === filterKey
    ? draft
    : { key: filterKey, query: urlState.query, statistics: urlState.statistics };
  const [attempt, setAttempt] = useState(0);
  const requestKey = `${urlState.query}\0${urlState.statistics}\0${urlState.cursor ?? ""}\0${attempt}`;
  const [state, setState] = useState<ListState>({ key: requestKey, status: "loading" });
  const [selected, setSelected] = useState<TeacherStudent>();
  const [mutationPending, setMutationPending] = useState(false);
  const [mutationError, setMutationError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const mountedRef = useRef(true);
  const terminalAuthRef = useRef(false);
  const authorizationGenerationRef = useRef(0);
  const listSequenceRef = useRef(0);
  const activeMutationRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      authorizationGenerationRef.current += 1;
      listSequenceRef.current += 1;
      activeMutationRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (rawSearch !== canonicalSearch && !terminalAuthRef.current) {
      router.replace(`${pathname}?${canonicalSearch}`);
    }
  }, [canonicalSearch, pathname, rawSearch, router]);

  const redirectAuthorization = useCallback((code: AuthorizationCode) => {
    if (!mountedRef.current || terminalAuthRef.current) return;
    terminalAuthRef.current = true;
    authorizationGenerationRef.current += 1;
    listSequenceRef.current += 1;
    activeMutationRef.current = false;
    setMutationPending(false);
    setState({ key: "terminal-auth", status: "auth" });
    router.replace(code === "AUTH_REQUIRED" ? "/teacher/login" : "/teacher/apply");
  }, [router]);

  useEffect(() => {
    let active = true;
    const sequence = listSequenceRef.current + 1;
    listSequenceRef.current = sequence;
    const authorizationGeneration = authorizationGenerationRef.current;
    api.get<StudentPage>(apiPath(urlState))
      .then((response) => {
        if (
          active
          && mountedRef.current
          && !terminalAuthRef.current
          && sequence === listSequenceRef.current
          && authorizationGeneration === authorizationGenerationRef.current
        ) {
          setState({ key: requestKey, status: "ready", response });
        }
      })
      .catch((caught: unknown) => {
        if (
          !active
          || !mountedRef.current
          || terminalAuthRef.current
          || sequence !== listSequenceRef.current
          || authorizationGeneration !== authorizationGenerationRef.current
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
          message: caught instanceof ApiClientError ? caught.message : "학생 목록을 불러오지 못했습니다.",
        });
      });
    return () => {
      active = false;
    };
  }, [attempt, redirectAuthorization, requestKey, urlState]);

  if (state.status === "auth") {
    return <main className="teacher-students-shell"><p role="status">권한 확인 페이지로 이동하고 있습니다.</p></main>;
  }

  const currentState = state.key === requestKey
    ? state
    : { key: requestKey, status: "loading" as const };
  const response = currentState.status === "ready" ? currentState.response : undefined;

  function refresh() {
    if (mutationPending || terminalAuthRef.current) return;
    setAttempt((current) => current + 1);
  }

  function applyFilters() {
    if (mutationPending || terminalAuthRef.current) return;
    const next: UrlState = {
      query: normalizeWhitespace(activeDraft.query).slice(0, 80),
      statistics: activeDraft.statistics,
    };
    router.push(`${pathname}?${urlParams(next).toString()}`);
  }

  function nextPage() {
    if (!response?.next_cursor || mutationPending || terminalAuthRef.current) return;
    router.push(`${pathname}?${urlParams({ ...urlState, cursor: response.next_cursor }).toString()}`);
  }

  function chooseStudent(student: TeacherStudent) {
    if (mutationPending || terminalAuthRef.current) return;
    setMutationError(undefined);
    setNotice(undefined);
    setSelected(student);
  }

  async function saveStudent(command: StudentUpdateCommand) {
    if (activeMutationRef.current || terminalAuthRef.current || !selected) return;
    activeMutationRef.current = true;
    setMutationPending(true);
    setMutationError(undefined);
    setNotice(undefined);
    const authorizationGeneration = authorizationGenerationRef.current;
    const studentId = selected.user_id;
    try {
      await api.patch<TeacherStudent>(`/api/teacher/students/${studentId}`, command);
      if (
        !mountedRef.current
        || terminalAuthRef.current
        || authorizationGeneration !== authorizationGenerationRef.current
        || !activeMutationRef.current
      ) return;
      setSelected(undefined);
      setNotice("학생 정보를 수정했습니다.");
      setAttempt((current) => current + 1);
    } catch (caught: unknown) {
      if (
        !mountedRef.current
        || terminalAuthRef.current
        || authorizationGeneration !== authorizationGenerationRef.current
        || !activeMutationRef.current
      ) return;
      if (caught instanceof ApiClientError && caught.code === "AUTH_REQUIRED") {
        redirectAuthorization("AUTH_REQUIRED");
        return;
      }
      if (caught instanceof ApiClientError && caught.code === "FORBIDDEN") {
        redirectAuthorization("FORBIDDEN");
        return;
      }
      setMutationError(caught instanceof ApiClientError ? caught.message : "학생 정보를 수정하지 못했습니다.");
    } finally {
      if (mountedRef.current && !terminalAuthRef.current) {
        activeMutationRef.current = false;
        setMutationPending(false);
      }
    }
  }

  return (
    <main className="teacher-students-shell">
      <header className="teacher-students-header">
        <div>
          <p className="eyebrow">Teacher students</p>
          <h1>학생 관리</h1>
          <p>학생이 직접 가입한 계정의 연락처와 통계 포함 여부를 관리합니다.</p>
        </div>
        <button type="button" className="secondary-button" disabled={mutationPending} onClick={refresh}>새로고침</button>
      </header>

      {notice ? <p className="notice" role="status">{notice}</p> : null}
      {mutationError ? <p className="inline-alert" role="alert">{mutationError}</p> : null}

      <form
        className="student-filter-card"
        aria-label="학생 검색 및 필터"
        onSubmit={(event) => {
          event.preventDefault();
          applyFilters();
        }}
      >
        <label>
          학생 검색
          <input
            value={activeDraft.query}
            maxLength={80}
            placeholder="이름, 이메일, 연락처"
            onChange={(event) => setDraft({ ...activeDraft, query: event.target.value })}
          />
        </label>
        <label>
          통계 상태
          <select
            value={activeDraft.statistics}
            onChange={(event) => setDraft({
              ...activeDraft,
              statistics: event.target.value as StatisticsFilter,
            })}
          >
            <option value="all">전체</option>
            <option value="included">통계 포함</option>
            <option value="excluded">통계 제외</option>
          </select>
        </label>
        <button type="submit" className="primary-button" disabled={mutationPending}>검색 적용</button>
      </form>

      <section className="student-list-card" aria-labelledby="student-list-title">
        <div className="student-list-heading">
          <div>
            <p className="eyebrow">Self-registered students</p>
            <h2 id="student-list-title">가입 학생</h2>
          </div>
          <span>한 번에 최대 {PAGE_SIZE}명</span>
        </div>
        {currentState.status === "loading" ? <p className="student-list-message" role="status">학생 목록을 불러오고 있습니다.</p> : null}
        {currentState.status === "error" ? (
          <div className="student-list-message student-list-message--error" role="alert">
            <p>{currentState.message}</p>
            <button type="button" className="primary-button" onClick={refresh}>다시 시도</button>
          </div>
        ) : null}
        {response && response.items.length === 0 ? <p className="student-list-message">조건에 맞는 학생이 없습니다.</p> : null}
        {response && response.items.length > 0 ? (
          <>
            <StudentTable students={response.items} disabled={mutationPending} onEdit={chooseStudent} />
            <StudentCards students={response.items} disabled={mutationPending} onEdit={chooseStudent} />
          </>
        ) : null}
        {response?.next_cursor ? (
          <nav className="student-pagination" aria-label="학생 목록 페이지">
            <button type="button" className="secondary-button" disabled={mutationPending} onClick={nextPage}>다음 학생</button>
          </nav>
        ) : null}
      </section>

      {selected ? (
        <StudentEditor
          key={selected.user_id}
          student={selected}
          saving={mutationPending}
          onSave={(command) => void saveStudent(command)}
          onCancel={() => {
            if (!mutationPending) setSelected(undefined);
          }}
        />
      ) : null}
    </main>
  );
}

export default function TeacherStudentsPage() {
  return (
    <Suspense fallback={<main className="teacher-students-shell"><p role="status">학생 목록을 불러오고 있습니다.</p></main>}>
      <TeacherStudentsManager />
    </Suspense>
  );
}
