import type { EventSeries } from "./event-form";

const SEOUL_DATE_TIME = new Intl.DateTimeFormat("ko-KR", {
  timeZone: "Asia/Seoul",
  year: "numeric",
  month: "long",
  day: "numeric",
  weekday: "long",
  hour: "numeric",
  minute: "2-digit",
});

function formatSeoulDateTime(value: string): string {
  return SEOUL_DATE_TIME.format(new Date(value));
}

function recurrenceLabel(event: EventSeries): string {
  if (!event.repeat_weekly) return "한 번";
  if (!event.repeat_until) return "매주 · 종료일 없음";
  const [, month, day] = event.repeat_until.split("-").map(Number);
  return `매주 · ${month}월 ${day}일까지`;
}

export function sortEventSeries(events: EventSeries[]): EventSeries[] {
  return [...events].sort((left, right) => {
    const startDifference = Date.parse(left.starts_at) - Date.parse(right.starts_at);
    if (Number.isFinite(startDifference) && startDifference !== 0) return startDifference;
    return left.id.localeCompare(right.id);
  });
}

type EventListProps = {
  events: EventSeries[];
  deletingId?: string;
  onEdit: (event: EventSeries) => void;
  onDelete: (event: EventSeries) => void;
};

export default function EventList({ events, deletingId, onEdit, onDelete }: EventListProps) {
  if (!events.length) return <p className="teacher-event-empty">등록된 일정이 없습니다.</p>;

  return (
    <ul className="teacher-event-list" aria-label="등록된 일정">
      {sortEventSeries(events).map((event) => (
        <li key={event.id}>
          <article className="teacher-event-card">
            <div className="teacher-event-card__heading">
              <div>
                <span className="event-series-badge">{recurrenceLabel(event)}</span>
                <h3>{event.title}</h3>
              </div>
              <div className="teacher-event-card__actions">
                <button className="secondary-button" type="button" onClick={() => onEdit(event)} aria-label={`${event.title} 수정`}>수정</button>
                <button className="danger-button" type="button" disabled={deletingId === event.id} onClick={() => onDelete(event)} aria-label={`${event.title} 삭제`}>
                  {deletingId === event.id ? "삭제 중…" : "삭제"}
                </button>
              </div>
            </div>
            <p className="teacher-event-card__time">
              <time dateTime={event.starts_at}>{formatSeoulDateTime(event.starts_at)}</time>
              {" – "}
              <time dateTime={event.ends_at}>{formatSeoulDateTime(event.ends_at)}</time>
            </p>
            {event.location ? <p className="teacher-event-card__location">장소: {event.location}</p> : null}
            {event.description ? <p className="teacher-event-card__description">{event.description}</p> : null}
          </article>
        </li>
      ))}
    </ul>
  );
}
