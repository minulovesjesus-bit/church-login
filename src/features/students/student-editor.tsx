"use client";

import { useState, type FormEvent } from "react";

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

function errorMessage(message?: string) {
  return message ? <span className="student-editor__error" role="alert">{message}</span> : null;
}

type StudentEditorProps = {
  student: TeacherStudent;
  saving?: boolean;
  onSave: (command: StudentUpdateCommand) => void;
  onCancel: () => void;
};

export default function StudentEditor({ student, saving = false, onSave, onCancel }: StudentEditorProps) {
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

  return (
    <aside className="student-editor" aria-labelledby="student-editor-title">
      <div className="student-editor__header">
        <div>
          <p className="eyebrow">Student profile</p>
          <h2 id="student-editor-title">학생 정보 수정</h2>
        </div>
        <button type="button" className="quiet-button" disabled={saving} onClick={onCancel}>닫기</button>
      </div>
      <form className="student-editor__form" onSubmit={submit}>
        <div className="student-editor__readonly-field">
          <label htmlFor="student-account-email">계정 이메일</label>
          <input id="student-account-email" value={student.email} readOnly aria-readonly="true" />
          <span>로그인 계정 이메일은 이 화면에서 변경할 수 없습니다.</span>
        </div>
        <div className="student-editor__field">
          <label htmlFor="student-name">이름</label>
          <input
            id="student-name"
            value={values.name}
            aria-invalid={Boolean(errors.name)}
            onChange={(event) => setValues((current) => ({ ...current, name: event.target.value }))}
          />
          {errorMessage(errors.name)}
        </div>
        <div className="student-editor__field">
          <label htmlFor="student-birth-date">생년월일</label>
          <input
            id="student-birth-date"
            type="date"
            value={values.birthDate}
            aria-invalid={Boolean(errors.birthDate)}
            onChange={(event) => setValues((current) => ({ ...current, birthDate: event.target.value }))}
          />
          {errorMessage(errors.birthDate)}
        </div>
        <div className="student-editor__field">
          <label htmlFor="student-phone">연락처</label>
          <input
            id="student-phone"
            inputMode="numeric"
            value={values.phone}
            aria-invalid={Boolean(errors.phone)}
            onChange={(event) => setValues((current) => ({ ...current, phone: event.target.value }))}
          />
          {errorMessage(errors.phone)}
        </div>
        <div className="student-editor__field">
          <label htmlFor="student-guardian-phone">보호자 연락처</label>
          <input
            id="student-guardian-phone"
            inputMode="numeric"
            value={values.guardianPhone}
            aria-invalid={Boolean(errors.guardianPhone)}
            onChange={(event) => setValues((current) => ({ ...current, guardianPhone: event.target.value }))}
          />
          {errorMessage(errors.guardianPhone)}
        </div>
        <fieldset>
          <legend>통계 상태</legend>
          <label className="student-editor__radio">
            <input
              type="radio"
              name="include-in-statistics"
              checked={values.includeInStatistics}
              onChange={() => setValues((current) => ({ ...current, includeInStatistics: true }))}
            />
            통계 포함
          </label>
          <label className="student-editor__radio">
            <input
              type="radio"
              name="include-in-statistics"
              checked={!values.includeInStatistics}
              onChange={() => setValues((current) => ({ ...current, includeInStatistics: false }))}
            />
            통계 제외
          </label>
          <p>통계 제외는 교사 전체 집계 통계에서만 제외합니다. 학생 로그인과 QR 출결은 계속 이용할 수 있습니다.</p>
        </fieldset>
        <div className="student-editor__actions">
          <button type="button" className="secondary-button" disabled={saving} onClick={onCancel}>수정 취소</button>
          <button type="submit" className="primary-button" disabled={saving}>
            {saving ? "저장 중…" : "학생 정보 저장"}
          </button>
        </div>
      </form>
    </aside>
  );
}
