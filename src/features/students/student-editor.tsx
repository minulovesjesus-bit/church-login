"use client";

import { useId, useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import type { TeacherStudent } from "./student-table";

export type StudentUpdateCommand = {
  name: string;
  birth_date: string;
  phone: string;
  guardian_phone: string;
  include_in_statistics: boolean;
};

type EditorValues = {
  name: string;
  birthDate: string;
  phone: string;
  guardianPhone: string;
  includeInStatistics: boolean;
};

type EditorErrors = Partial<Record<keyof EditorValues, string>>;

function digitsOnly(value: string): string {
  return value.replace(/\D/g, "");
}

function isCalendarDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const calendar = new Date(0);
  calendar.setUTCFullYear(year, month - 1, day);
  calendar.setUTCHours(12, 0, 0, 0);
  return year >= 1
    && year <= 9999
    && calendar.getUTCFullYear() === year
    && calendar.getUTCMonth() === month - 1
    && calendar.getUTCDate() === day;
}

function todayInSeoul(): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function validate(values: EditorValues): { errors: EditorErrors; command?: StudentUpdateCommand } {
  const errors: EditorErrors = {};
  const name = values.name.trim().replace(/\s+/g, " ");
  const phone = digitsOnly(values.phone);
  const guardianPhone = digitsOnly(values.guardianPhone);
  if (!name) errors.name = "이름을 입력해 주세요.";
  else if (name.length > 80) errors.name = "이름은 80자 이하로 입력해 주세요.";
  if (!isCalendarDate(values.birthDate) || values.birthDate > todayInSeoul()) {
    errors.birthDate = "미래가 아닌 실제 생년월일을 입력해 주세요.";
  }
  if (phone.length < 10 || phone.length > 11) {
    errors.phone = "연락처는 숫자 10~11자리로 입력해 주세요.";
  }
  if (guardianPhone.length < 10 || guardianPhone.length > 11) {
    errors.guardianPhone = "보호자 연락처는 숫자 10~11자리로 입력해 주세요.";
  }
  if (Object.keys(errors).length) return { errors };
  return {
    errors,
    command: {
      name,
      birth_date: values.birthDate,
      phone,
      guardian_phone: guardianPhone,
      include_in_statistics: values.includeInStatistics,
    },
  };
}

type StudentEditorProps = {
  student: TeacherStudent;
  saving?: boolean;
  requestError?: string;
  onSave: (command: StudentUpdateCommand) => void;
  onCancel: () => void;
};

export default function StudentEditor({ student, saving = false, requestError, onSave, onCancel }: StudentEditorProps) {
  const generatedId = useId().replace(/:/g, "");
  const fieldId = (name: string) => `student-editor-${generatedId}-${name}`;
  const [values, setValues] = useState<EditorValues>({
    name: student.name,
    birthDate: student.birth_date,
    phone: student.phone,
    guardianPhone: student.guardian_phone,
    includeInStatistics: student.include_in_statistics,
  });
  const [errors, setErrors] = useState<EditorErrors>({});

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    const result = validate(values);
    setErrors(result.errors);
    if (result.command) onSave(result.command);
  }

  function describedBy(name: keyof EditorErrors): string | undefined {
    return errors[name] ? fieldId(`${name}-error`) : undefined;
  }

  return (
    <Sheet open onOpenChange={(open) => {
      if (!open && !saving) onCancel();
    }}>
      <SheetContent className="student-editor" showCloseButton={false} aria-modal="true">
        <SheetHeader className="student-editor__header">
          <div>
            <SheetTitle>{student.name} 학생 정보 수정</SheetTitle>
            <SheetDescription>학생이 직접 가입한 계정의 연락처와 통계 포함 여부를 수정합니다.</SheetDescription>
          </div>
          <Button type="button" variant="ghost" disabled={saving} onClick={onCancel}>닫기</Button>
        </SheetHeader>
        <form className="student-editor__form" onSubmit={submit} noValidate>
          {requestError ? <Alert variant="destructive"><AlertDescription>{requestError}</AlertDescription></Alert> : null}
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor={fieldId("email")}>계정 이메일</FieldLabel>
              <Input id={fieldId("email")} value={student.email} readOnly aria-readonly="true" />
              <FieldDescription>로그인 계정 이메일은 이 화면에서 변경할 수 없습니다.</FieldDescription>
            </Field>
            <Field data-invalid={Boolean(errors.name)}>
              <FieldLabel htmlFor={fieldId("name")}>이름</FieldLabel>
              <Input
                id={fieldId("name")}
                autoFocus
                value={values.name}
                aria-invalid={Boolean(errors.name)}
                aria-describedby={describedBy("name")}
                onChange={(event) => setValues((current) => ({ ...current, name: event.target.value }))}
              />
              <FieldError id={fieldId("name-error")}>{errors.name}</FieldError>
            </Field>
            <Field data-invalid={Boolean(errors.birthDate)}>
              <FieldLabel htmlFor={fieldId("birth-date")}>생년월일</FieldLabel>
              <Input
                id={fieldId("birth-date")}
                type="date"
                value={values.birthDate}
                aria-invalid={Boolean(errors.birthDate)}
                aria-describedby={describedBy("birthDate")}
                onChange={(event) => setValues((current) => ({ ...current, birthDate: event.target.value }))}
              />
              <FieldError id={fieldId("birthDate-error")}>{errors.birthDate}</FieldError>
            </Field>
            <Field data-invalid={Boolean(errors.phone)}>
              <FieldLabel htmlFor={fieldId("phone")}>연락처</FieldLabel>
              <Input
                id={fieldId("phone")}
                inputMode="numeric"
                value={values.phone}
                aria-invalid={Boolean(errors.phone)}
                aria-describedby={describedBy("phone")}
                onChange={(event) => setValues((current) => ({ ...current, phone: event.target.value }))}
              />
              <FieldError id={fieldId("phone-error")}>{errors.phone}</FieldError>
            </Field>
            <Field data-invalid={Boolean(errors.guardianPhone)}>
              <FieldLabel htmlFor={fieldId("guardian-phone")}>보호자 연락처</FieldLabel>
              <Input
                id={fieldId("guardian-phone")}
                inputMode="numeric"
                value={values.guardianPhone}
                aria-invalid={Boolean(errors.guardianPhone)}
                aria-describedby={describedBy("guardianPhone")}
                onChange={(event) => setValues((current) => ({ ...current, guardianPhone: event.target.value }))}
              />
              <FieldError id={fieldId("guardianPhone-error")}>{errors.guardianPhone}</FieldError>
            </Field>
            <FieldSet>
              <FieldLegend>통계 상태</FieldLegend>
              <FieldGroup>
                <Field orientation="horizontal">
                  <FieldLabel className="student-editor__radio min-h-11" htmlFor={fieldId("statistics-included")}>
                    <input
                      id={fieldId("statistics-included")}
                      type="radio"
                      name={fieldId("include-in-statistics")}
                      checked={values.includeInStatistics}
                      onChange={() => setValues((current) => ({ ...current, includeInStatistics: true }))}
                    />
                    통계 포함
                  </FieldLabel>
                </Field>
                <Field orientation="horizontal">
                  <FieldLabel className="student-editor__radio min-h-11" htmlFor={fieldId("statistics-excluded")}>
                    <input
                      id={fieldId("statistics-excluded")}
                      type="radio"
                      name={fieldId("include-in-statistics")}
                      checked={!values.includeInStatistics}
                      onChange={() => setValues((current) => ({ ...current, includeInStatistics: false }))}
                    />
                    통계 제외
                  </FieldLabel>
                </Field>
              </FieldGroup>
              <FieldDescription>
                통계 제외는 교사 전체 집계 통계에서만 제외합니다. 학생 로그인과 QR 출결은 계속 이용할 수 있습니다.
              </FieldDescription>
            </FieldSet>
          </FieldGroup>
          <SheetFooter className="student-editor__actions">
            <Button type="button" variant="outline" disabled={saving} onClick={onCancel}>수정 취소</Button>
            <Button type="submit" disabled={saving}>{saving ? "저장 중…" : "학생 정보 저장"}</Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}
