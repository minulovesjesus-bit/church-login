"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { ApiClientError, api } from "@/lib/api/client";
import { adjacentSeoulWeek } from "@/features/events/week-navigation";

export type EventOccurrence = {
  occurrence_id: string;
  event_id: string;
  title: string;
  description: string | null;
  local_start: string;
  local_end: string;
  location: string | null;
};

const SEOUL = "Asia/Seoul";
const datePartsFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: SEOUL,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
const dateLabelFormatter = new Intl.DateTimeFormat("ko-KR", {
  timeZone: SEOUL,
  month: "long",
  day: "numeric",
  weekday: "long",
});
const timeFormatter = new Intl.DateTimeFormat("ko-KR", {
  timeZone: SEOUL,
  hour: "numeric",
  minute: "2-digit",
});

function asDate(value: string): Date {
  return new Date(value);
}

function seoulDateKey(value: string): string {
  const parts = datePartsFormatter.formatToParts(asDate(value));
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export function formatSeoulDateLabel(value: string): string {
  return dateLabelFormatter.format(asDate(value));
}

function formatSeoulTime(value: string): string {
  return timeFormatter.format(asDate(value));
}

function sortOccurrences(events: EventOccurrence[]): EventOccurrence[] {
  return [...events].sort((left, right) => {
    const timeDifference = asDate(left.local_start).getTime() - asDate(right.local_start).getTime();
    if (Number.isFinite(timeDifference) && timeDifference !== 0) return timeDifference;
    return left.occurrence_id.localeCompare(right.occurrence_id);
  });
}

export function EventCard({ event }: { event: EventOccurrence }) {
  return (
    <article className="event-card">
      <div className="event-card__heading">
        <h3>{event.title}</h3>
        <p className="event-card__time">
          <time dateTime={event.local_start}>{formatSeoulTime(event.local_start)}</time>
          {" – "}
          <time dateTime={event.local_end}>{formatSeoulTime(event.local_end)}</time>
        </p>
      </div>
      {event.location ? <p className="event-card__location">{event.location}</p> : null}
      {event.description ? <p className="event-card__description">{event.description}</p> : null}
    </article>
  );
}

type EventsState =
  | { week: string; status: "loading"; events: EventOccurrence[] }
  | { week: string; status: "ready"; events: EventOccurrence[] }
  | { week: string; status: "error"; events: EventOccurrence[]; message: string }
  | { week: string; status: "auth"; events: EventOccurrence[] };

export function EventOccurrences({ week, limit }: { week: string; limit?: number }) {
  const router = useRouter();
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<EventsState>({ week, status: "loading", events: [] });

  useEffect(() => {
    let active = true;
    const to = adjacentSeoulWeek(week, 1);

    api.get<EventOccurrence[]>(`/api/events?from=${week}&to=${to}`)
      .then((events) => {
        if (active) setState({ week, status: "ready", events });
      })
      .catch((caught: unknown) => {
        if (!active) return;
        if (caught instanceof ApiClientError && caught.code === "AUTH_REQUIRED") {
          router.replace("/auth/login");
          setState({ week, status: "auth", events: [] });
          return;
        }
        setState({
          week,
          status: "error",
          events: [],
          message: caught instanceof ApiClientError ? caught.message : "일정을 불러오지 못했습니다.",
        });
      });

    return () => {
      active = false;
    };
  }, [attempt, router, week]);

  const isLoading = state.week !== week || state.status === "loading";
  const events = useMemo(() => (state.week === week ? sortOccurrences(state.events).slice(0, limit) : []), [limit, state.events, state.week, week]);
  const grouped = useMemo(() => {
    const groups = new Map<string, EventOccurrence[]>();
    events.forEach((event) => {
      const key = seoulDateKey(event.local_start);
      groups.set(key, [...(groups.get(key) ?? []), event]);
    });
    return [...groups.entries()];
  }, [events]);

  if (isLoading) return <p className="event-loading" role="status">일정을 불러오고 있습니다.</p>;
  if (state.status === "auth") return <p className="event-loading" role="status">로그인 페이지로 이동하고 있습니다.</p>;
  if (state.status === "error") {
    return <div className="event-error" role="alert"><p>{state.message}</p><button className="secondary-button" type="button" onClick={() => { setState({ week, status: "loading", events: [] }); setAttempt((value) => value + 1); }}>다시 시도</button></div>;
  }
  if (!events.length) return <p className="event-empty">이번 주 등록된 일정이 없습니다.</p>;

  return (
    <ul className="event-list" aria-label="주간 일정 목록">
      {grouped.flatMap(([date, groupedEvents]) => [
        <li className="event-list__date" key={`${date}-heading`} role="presentation"><h2>{formatSeoulDateLabel(groupedEvents[0].local_start)}</h2></li>,
        ...groupedEvents.map((event) => <li className="event-list__item" key={event.occurrence_id}><EventCard event={event} /></li>),
      ])}
    </ul>
  );
}
