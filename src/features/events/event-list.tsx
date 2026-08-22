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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import type { EventSeries } from "./event-form";
import { formatSeoulDateTime } from "./seoul-time";

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
  disabled?: boolean;
  onEdit: (event: EventSeries) => void;
  onDelete: (event: EventSeries) => void;
};

function deletionTitle(event: EventSeries): string {
  return event.repeat_weekly
    ? `${event.title} 반복 일정 삭제`
    : `${event.title} 일정 삭제`;
}

function deletionDescription(event: EventSeries): string {
  return event.repeat_weekly
    ? `${event.title} 반복 일정 전체를 삭제하시겠습니까?`
    : `${event.title} 일정을 삭제하시겠습니까?`;
}

export default function EventList({ events, deletingId, disabled = false, onEdit, onDelete }: EventListProps) {
  if (!events.length) {
    return (
      <Empty className="teacher-event-empty">
        <EmptyHeader><EmptyTitle>등록된 일정이 없습니다.</EmptyTitle></EmptyHeader>
      </Empty>
    );
  }

  return (
    <ul className="teacher-event-list" aria-label="등록된 일정">
      {sortEventSeries(events).map((event) => (
        <li key={event.id}>
          <Card className="teacher-event-card">
            <CardHeader className="teacher-event-card__heading">
              <div>
                <Badge variant="secondary">{recurrenceLabel(event)}</Badge>
                <CardTitle><h3>{event.title}</h3></CardTitle>
              </div>
              <div className="teacher-event-card__actions">
                <Button type="button" variant="outline" size="sm" disabled={disabled} onClick={() => onEdit(event)} aria-label={`${event.title} 수정`}>수정</Button>
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button
                      variant="destructive"
                      size="sm"
                      type="button"
                      disabled={disabled || deletingId === event.id}
                      aria-label={`${event.title} 삭제`}
                    >
                      {deletingId === event.id ? "삭제 중…" : "삭제"}
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>{deletionTitle(event)}</AlertDialogTitle>
                      <AlertDialogDescription>{deletionDescription(event)}</AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>취소</AlertDialogCancel>
                      <AlertDialogAction
                        variant="destructive"
                        aria-label={`${event.title} 삭제 확인`}
                        onClick={() => onDelete(event)}
                      >
                        삭제
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            </CardHeader>
            <CardContent>
              <p className="teacher-event-card__time">
                <time dateTime={event.starts_at}>{formatSeoulDateTime(event.starts_at)}</time>
                {" – "}
                <time dateTime={event.ends_at}>{formatSeoulDateTime(event.ends_at)}</time>
              </p>
              {event.location ? <p className="teacher-event-card__location">장소: {event.location}</p> : null}
              {event.description ? <p className="teacher-event-card__description">{event.description}</p> : null}
            </CardContent>
          </Card>
        </li>
      ))}
    </ul>
  );
}
