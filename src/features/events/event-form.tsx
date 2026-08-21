"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { z } from "zod";

import { api, ApiClientError } from "@/lib/api/client";

const MAX_DURATION_MILLISECONDS = 7 * 24 * 60 * 60 * 1000;
const LOCAL_DATETIME_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;
const CALENDAR_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

export type EventSeries = {
  id: string;
  title: string;
  description: string | null;
  location: string | null;
  starts_at: string;
  ends_at: string;
  repeat_weekly: boolean;
  repeat_until: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
};

export type EventCommand = {
  title: string;
  description: string | null;
  location: string | null;
  starts_at: string;
  ends_at: string;
  repeat_weekly: boolean;
  repeat_until: string | null;
};

type LocalDateTime = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  milliseconds: number;
};

function parseSeoulLocal(value: string): LocalDateTime | null {
  const match = LOCAL_DATETIME_PATTERN.exec(value);
  if (!match) return null;
  const [, yearText, monthText, dayText, hourText, minuteText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  if (year < 1 || month < 1 || month > 12 || hour > 23 || minute > 59) return null;

  const instant = new Date(0);
  instant.setUTCFullYear(year, month - 1, day);
  instant.setUTCHours(hour - 9, minute, 0, 0);
  const seoulCalendar = new Date(instant.getTime() + 9 * 60 * 60 * 1000);
  if (
    seoulCalendar.getUTCFullYear() !== year
    || seoulCalendar.getUTCMonth() !== month - 1
    || seoulCalendar.getUTCDate() !== day
    || seoulCalendar.getUTCHours() !== hour
    || seoulCalendar.getUTCMinutes() !== minute
  ) {
    return null;
  }
  return { year, month, day, hour, minute, milliseconds: instant.getTime() };
}

function isCalendarDate(value: string): boolean {
  const match = CALENDAR_DATE_PATTERN.exec(value);
  if (!match) return false;
  const [, yearText, monthText, dayText] = match;
  return parseSeoulLocal(`${yearText}-${monthText}-${dayText}T00:00`) !== null;
}

export function seoulLocalToIsoInstant(value: string): string | null {
  const parsed = parseSeoulLocal(value);
  return parsed ? new Date(parsed.milliseconds).toISOString() : null;
}

export function isoInstantToSeoulLocal(value: string): string {
  const instant = new Date(value);
  if (Number.isNaN(instant.getTime())) return "";
  const seoulCalendar = new Date(instant.getTime() + 9 * 60 * 60 * 1000);
  const year = String(seoulCalendar.getUTCFullYear()).padStart(4, "0");
  const month = String(seoulCalendar.getUTCMonth() + 1).padStart(2, "0");
  const day = String(seoulCalendar.getUTCDate()).padStart(2, "0");
  const hour = String(seoulCalendar.getUTCHours()).padStart(2, "0");
  const minute = String(seoulCalendar.getUTCMinutes()).padStart(2, "0");
  return `${year}-${month}-${day}T${hour}:${minute}`;
}

const eventFormSchema = z.object({
  title: z.string(),
  description: z.string(),
  location: z.string(),
  startsAtLocal: z.string(),
  endsAtLocal: z.string(),
  repeatWeekly: z.boolean(),
  repeatUntil: z.string(),
}).superRefine((values, context) => {
  const title = values.title.trim();
  if (!title) {
    context.addIssue({ code: "custom", path: ["title"], message: "제목을 입력해 주세요." });
  } else if (title.length > 120) {
    context.addIssue({ code: "custom", path: ["title"], message: "제목은 120자 이하로 입력해 주세요." });
  }
  if (values.description.length > 2000) {
    context.addIssue({ code: "custom", path: ["description"], message: "설명은 2000자 이하로 입력해 주세요." });
  }
  if (values.location.length > 200) {
    context.addIssue({ code: "custom", path: ["location"], message: "장소는 200자 이하로 입력해 주세요." });
  }

  const startsAt = parseSeoulLocal(values.startsAtLocal);
  const endsAt = parseSeoulLocal(values.endsAtLocal);
  if (!startsAt) {
    context.addIssue({ code: "custom", path: ["startsAtLocal"], message: "존재하는 시작 날짜와 시간을 입력해 주세요." });
  }
  if (!endsAt) {
    context.addIssue({ code: "custom", path: ["endsAtLocal"], message: "존재하는 종료 날짜와 시간을 입력해 주세요." });
  }
  if (startsAt && endsAt) {
    const duration = endsAt.milliseconds - startsAt.milliseconds;
    if (duration <= 0) {
      context.addIssue({ code: "custom", path: ["endsAtLocal"], message: "종료 시간은 시작 시간보다 늦어야 합니다." });
    } else if (duration > MAX_DURATION_MILLISECONDS) {
      context.addIssue({ code: "custom", path: ["endsAtLocal"], message: "일정 기간은 7일을 넘을 수 없습니다." });
    }
  }

  if (values.repeatWeekly && values.repeatUntil) {
    if (!isCalendarDate(values.repeatUntil)) {
      context.addIssue({ code: "custom", path: ["repeatUntil"], message: "존재하는 반복 종료일을 입력해 주세요." });
    } else if (startsAt && values.repeatUntil < values.startsAtLocal.slice(0, 10)) {
      context.addIssue({ code: "custom", path: ["repeatUntil"], message: "반복 종료일은 첫 일정 날짜보다 빠를 수 없습니다." });
    }
  }
});

type EventFormValues = z.infer<typeof eventFormSchema>;
type AuthorizationCode = "AUTH_REQUIRED" | "FORBIDDEN";

function valuesFromEvent(event?: EventSeries): EventFormValues {
  return {
    title: event?.title ?? "",
    description: event?.description ?? "",
    location: event?.location ?? "",
    startsAtLocal: event ? isoInstantToSeoulLocal(event.starts_at) : "",
    endsAtLocal: event ? isoInstantToSeoulLocal(event.ends_at) : "",
    repeatWeekly: event?.repeat_weekly ?? false,
    repeatUntil: event?.repeat_until ?? "",
  };
}

function fieldError(message?: string) {
  return message ? <span className="event-form__error" role="alert">{message}</span> : null;
}

type EventFormProps = {
  event?: EventSeries;
  onSaved?: (action: "created" | "updated") => void;
  onCancel?: () => void;
  onAuthorizationError?: (code: AuthorizationCode) => void;
};

export default function EventForm({
  event,
  onSaved,
  onCancel,
  onAuthorizationError,
}: EventFormProps) {
  const [requestError, setRequestError] = useState<string>();
  const {
    control,
    formState: { errors, isSubmitting },
    handleSubmit,
    register,
    reset,
    setValue,
  } = useForm<EventFormValues>({
    resolver: zodResolver(eventFormSchema),
    defaultValues: valuesFromEvent(event),
  });
  const repeatWeekly = useWatch({ control, name: "repeatWeekly" });

  useEffect(() => {
    reset(valuesFromEvent(event));
  }, [event, reset]);

  const repeatRegistration = register("repeatWeekly");

  async function save(values: EventFormValues) {
    if (isSubmitting) return;
    const startsAt = seoulLocalToIsoInstant(values.startsAtLocal);
    const endsAt = seoulLocalToIsoInstant(values.endsAtLocal);
    if (!startsAt || !endsAt) return;
    const body: EventCommand = {
      title: values.title.trim(),
      description: values.description.trim() || null,
      location: values.location.trim() || null,
      starts_at: startsAt,
      ends_at: endsAt,
      repeat_weekly: values.repeatWeekly,
      repeat_until: values.repeatWeekly && values.repeatUntil ? values.repeatUntil : null,
    };

    setRequestError(undefined);
    try {
      if (event) {
        await api.patch<EventSeries>(`/api/teacher/events/${event.id}`, body);
        onSaved?.("updated");
      } else {
        await api.post<EventSeries>("/api/teacher/events", body);
        reset(valuesFromEvent());
        onSaved?.("created");
      }
    } catch (caught: unknown) {
      if (
        caught instanceof ApiClientError
        && (caught.code === "AUTH_REQUIRED" || caught.code === "FORBIDDEN")
      ) {
        onAuthorizationError?.(caught.code);
        return;
      }
      setRequestError(
        caught instanceof ApiClientError
          ? caught.message
          : event
            ? "일정을 수정하지 못했습니다."
            : "일정을 등록하지 못했습니다.",
      );
    }
  }

  return (
    <section className="teacher-event-form-card" aria-labelledby="event-form-title">
      <div className="teacher-event-section-heading">
        <div>
          <p className="eyebrow">Event series</p>
          <h2 id="event-form-title">{event ? "일정 수정" : "새 일정 등록"}</h2>
        </div>
        {event && onCancel ? <button className="quiet-button" type="button" onClick={onCancel}>수정 취소</button> : null}
      </div>
      {event?.repeat_weekly ? <p className="event-series-warning">반복 일정 전체가 변경됩니다.</p> : null}
      <form className="teacher-event-form" noValidate onSubmit={handleSubmit(save)}>
        <label>
          제목
          <input type="text" maxLength={121} aria-invalid={Boolean(errors.title)} {...register("title")} />
          {fieldError(errors.title?.message)}
        </label>
        <label className="teacher-event-form__wide">
          설명 <span>(선택)</span>
          <textarea aria-label="설명" rows={4} maxLength={2001} aria-invalid={Boolean(errors.description)} {...register("description")} />
          {fieldError(errors.description?.message)}
        </label>
        <label>
          장소 <span>(선택)</span>
          <input aria-label="장소" type="text" maxLength={201} aria-invalid={Boolean(errors.location)} {...register("location")} />
          {fieldError(errors.location?.message)}
        </label>
        <label>
          시작
          <input type="datetime-local" aria-invalid={Boolean(errors.startsAtLocal)} {...register("startsAtLocal")} />
          {fieldError(errors.startsAtLocal?.message)}
        </label>
        <label>
          종료
          <input type="datetime-local" aria-invalid={Boolean(errors.endsAtLocal)} {...register("endsAtLocal")} />
          {fieldError(errors.endsAtLocal?.message)}
        </label>
        <label className="teacher-event-form__checkbox">
          <input
            type="checkbox"
            {...repeatRegistration}
            onChange={(changeEvent) => {
              void repeatRegistration.onChange(changeEvent);
              if (!changeEvent.target.checked) {
                setValue("repeatUntil", "", { shouldDirty: true, shouldValidate: true });
              }
            }}
          />
          매주 반복
        </label>
        <label>
          반복 종료일 <span>(선택)</span>
          <input
            aria-label="반복 종료일"
            type="date"
            disabled={!repeatWeekly}
            aria-invalid={Boolean(errors.repeatUntil)}
            {...register("repeatUntil")}
          />
          {fieldError(errors.repeatUntil?.message)}
        </label>
        {requestError ? <p className="inline-alert teacher-event-form__wide" role="alert">{requestError}</p> : null}
        <div className="button-row teacher-event-form__actions">
          <button className="primary-button" type="submit" disabled={isSubmitting}>
            {isSubmitting ? "저장 중…" : "일정 저장"}
          </button>
          {event && onCancel ? <button className="secondary-button" type="button" disabled={isSubmitting} onClick={onCancel}>취소</button> : null}
        </div>
      </form>
    </section>
  );
}
