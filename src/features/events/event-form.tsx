"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { z } from "zod";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { api, ApiClientError } from "@/lib/api/client";
import {
  isoInstantToSeoulLocal,
  seoulLocalToIsoInstant,
} from "./seoul-time";

export { isoInstantToSeoulLocal, seoulLocalToIsoInstant } from "./seoul-time";

const MAX_DURATION_MILLISECONDS = 7 * 24 * 60 * 60 * 1000;
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

function isCalendarDate(value: string): boolean {
  const match = CALENDAR_DATE_PATTERN.exec(value);
  if (!match) return false;
  const [, yearText, monthText, dayText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  if (year < 1 || year > 9999 || month < 1 || month > 12) return false;
  const calendar = new Date(0);
  calendar.setUTCFullYear(year, month - 1, day);
  calendar.setUTCHours(12, 0, 0, 0);
  return calendar.getUTCFullYear() === year
    && calendar.getUTCMonth() === month - 1
    && calendar.getUTCDate() === day;
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

  const startsAt = seoulLocalToIsoInstant(values.startsAtLocal);
  const endsAt = seoulLocalToIsoInstant(values.endsAtLocal);
  if (!startsAt) {
    context.addIssue({ code: "custom", path: ["startsAtLocal"], message: "존재하는 시작 날짜와 시간을 입력해 주세요." });
  }
  if (!endsAt) {
    context.addIssue({ code: "custom", path: ["endsAtLocal"], message: "존재하는 종료 날짜와 시간을 입력해 주세요." });
  }
  if (startsAt && endsAt) {
    const duration = Date.parse(endsAt) - Date.parse(startsAt);
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

export type EventMutationControl = {
  begin: () => number | null;
  isCurrent: (token: number) => boolean;
  finish: (token: number) => void;
};

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

function fieldError(id: string, message?: string) {
  return <FieldError id={id}>{message}</FieldError>;
}

type EventFormProps = {
  event?: EventSeries;
  onSaved?: (action: "created" | "updated") => void;
  onCancel?: () => void;
  onAuthorizationError?: (code: AuthorizationCode) => void;
  mutationControl?: EventMutationControl;
  mutationPending?: boolean;
};

export default function EventForm({
  event,
  onSaved,
  onCancel,
  onAuthorizationError,
  mutationControl,
  mutationPending = false,
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

    const acquiredToken = mutationControl ? mutationControl.begin() : 0;
    if (acquiredToken === null) return;
    const mutationToken = acquiredToken;
    const isCurrent = () => !mutationControl || mutationControl.isCurrent(mutationToken);
    setRequestError(undefined);
    try {
      if (event) {
        await api.patch<EventSeries>(`/api/teacher/events/${event.id}`, body);
        if (!isCurrent()) return;
        onSaved?.("updated");
      } else {
        await api.post<EventSeries>("/api/teacher/events", body);
        if (!isCurrent()) return;
        reset(valuesFromEvent());
        onSaved?.("created");
      }
    } catch (caught: unknown) {
      if (!isCurrent()) return;
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
    } finally {
      if (mutationControl) mutationControl.finish(mutationToken);
    }
  }

  const controlsDisabled = isSubmitting || mutationPending;

  return (
    <Card className="teacher-event-form-card" aria-labelledby="event-form-title">
      <CardHeader className="teacher-event-section-heading">
        <CardTitle><h2 id="event-form-title">{event ? "일정 수정" : "새 일정 등록"}</h2></CardTitle>
        {event && onCancel ? <Button variant="ghost" type="button" disabled={controlsDisabled} onClick={onCancel}>수정 취소</Button> : null}
      </CardHeader>
      <CardContent>
        {event?.repeat_weekly ? (
          <Alert className="event-series-warning" role="note"><AlertDescription>반복 일정 전체가 변경됩니다.</AlertDescription></Alert>
        ) : null}
        <form noValidate onSubmit={handleSubmit(save)}>
          <FieldGroup className="teacher-event-form">
            <Field data-invalid={Boolean(errors.title)}>
              <FieldLabel htmlFor="event-title">제목</FieldLabel>
              <Input
                id="event-title"
                type="text"
                maxLength={121}
                disabled={controlsDisabled}
                aria-invalid={Boolean(errors.title)}
                aria-describedby={errors.title ? "event-title-error" : undefined}
                {...register("title")}
              />
              {fieldError("event-title-error", errors.title?.message)}
            </Field>
            <Field className="teacher-event-form__wide" data-invalid={Boolean(errors.description)}>
              <FieldLabel htmlFor="event-description">설명 <span>(선택)</span></FieldLabel>
              <Textarea
                id="event-description"
                aria-label="설명"
                rows={4}
                maxLength={2001}
                disabled={controlsDisabled}
                aria-invalid={Boolean(errors.description)}
                aria-describedby={errors.description ? "event-description-error" : undefined}
                {...register("description")}
              />
              {fieldError("event-description-error", errors.description?.message)}
            </Field>
            <Field data-invalid={Boolean(errors.location)}>
              <FieldLabel htmlFor="event-location">장소 <span>(선택)</span></FieldLabel>
              <Input
                id="event-location"
                aria-label="장소"
                type="text"
                maxLength={201}
                disabled={controlsDisabled}
                aria-invalid={Boolean(errors.location)}
                aria-describedby={errors.location ? "event-location-error" : undefined}
                {...register("location")}
              />
              {fieldError("event-location-error", errors.location?.message)}
            </Field>
            <Field data-invalid={Boolean(errors.startsAtLocal)}>
              <FieldLabel htmlFor="event-starts-at">시작</FieldLabel>
              <Input
                id="event-starts-at"
                type="datetime-local"
                disabled={controlsDisabled}
                aria-invalid={Boolean(errors.startsAtLocal)}
                aria-describedby={errors.startsAtLocal ? "event-starts-at-error" : undefined}
                {...register("startsAtLocal")}
              />
              {fieldError("event-starts-at-error", errors.startsAtLocal?.message)}
            </Field>
            <Field data-invalid={Boolean(errors.endsAtLocal)}>
              <FieldLabel htmlFor="event-ends-at">종료</FieldLabel>
              <Input
                id="event-ends-at"
                type="datetime-local"
                disabled={controlsDisabled}
                aria-invalid={Boolean(errors.endsAtLocal)}
                aria-describedby={errors.endsAtLocal ? "event-ends-at-error" : undefined}
                {...register("endsAtLocal")}
              />
              {fieldError("event-ends-at-error", errors.endsAtLocal?.message)}
            </Field>
            <FieldSet className="teacher-event-form__wide">
              <FieldLegend>반복 설정</FieldLegend>
              <FieldGroup className="teacher-event-recurrence">
                <Field orientation="horizontal">
                  <FieldLabel className="teacher-event-form__checkbox min-h-11" htmlFor="event-repeat-weekly">
                    <input
                      id="event-repeat-weekly"
                      type="checkbox"
                      disabled={controlsDisabled}
                      {...repeatRegistration}
                      onChange={(changeEvent) => {
                        void repeatRegistration.onChange(changeEvent);
                        if (!changeEvent.target.checked) {
                          setValue("repeatUntil", "", { shouldDirty: true, shouldValidate: true });
                        }
                      }}
                    />
                    매주 반복
                  </FieldLabel>
                </Field>
                <Field data-disabled={controlsDisabled || !repeatWeekly} data-invalid={Boolean(errors.repeatUntil)}>
                  <FieldLabel htmlFor="event-repeat-until">반복 종료일 <span>(선택)</span></FieldLabel>
                  <Input
                    id="event-repeat-until"
                    aria-label="반복 종료일"
                    type="date"
                    disabled={controlsDisabled || !repeatWeekly}
                    aria-invalid={Boolean(errors.repeatUntil)}
                    aria-describedby={errors.repeatUntil ? "event-repeat-until-error" : undefined}
                    {...register("repeatUntil")}
                  />
                  {fieldError("event-repeat-until-error", errors.repeatUntil?.message)}
                </Field>
              </FieldGroup>
            </FieldSet>
            {requestError ? (
              <Alert className="teacher-event-form__wide" variant="destructive"><AlertDescription>{requestError}</AlertDescription></Alert>
            ) : null}
            <div className="teacher-event-form__actions">
              <Button type="submit" disabled={controlsDisabled}>{isSubmitting ? "저장 중…" : "일정 저장"}</Button>
              {event && onCancel ? <Button variant="outline" type="button" disabled={controlsDisabled} onClick={onCancel}>취소</Button> : null}
            </div>
          </FieldGroup>
        </form>
      </CardContent>
    </Card>
  );
}
