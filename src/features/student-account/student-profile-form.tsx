"use client";

import { useState, type FormEvent } from "react";

import {
  birthDateParts,
  birthDateValue,
  SegmentedBirthDateInput,
  SegmentedPhoneInput,
  type BirthDateParts,
} from "@/components/forms/segmented-inputs";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";

import type { EditableStudentProfile, StudentProfile } from "./types";

const digitsOnly = (value: string) => value.replace(/\D/g, "");

type StudentProfileFormProps = {
  email: string;
  profile: StudentProfile;
  pending: boolean;
  error?: string;
  onCancel: () => void;
  onSubmit: (profile: EditableStudentProfile) => void | Promise<void>;
};

export function StudentProfileForm({
  email,
  profile,
  pending,
  error,
  onCancel,
  onSubmit,
}: StudentProfileFormProps) {
  const [name, setName] = useState(profile.name);
  const [birthDate, setBirthDate] = useState<BirthDateParts>(() => (
    birthDateParts(profile.birth_date)
  ));
  const [phone, setPhone] = useState(() => digitsOnly(profile.phone));
  const [guardianPhone, setGuardianPhone] = useState(() => digitsOnly(profile.guardian_phone));
  const hasError = Boolean(error);
  const errorId = hasError ? "student-profile-error" : undefined;

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    onSubmit({
      name: name.trim(),
      birth_date: birthDateValue(birthDate),
      phone: digitsOnly(phone),
      guardian_phone: digitsOnly(guardianPhone),
    });
  }

  return (
    <form onSubmit={submit}>
      <FieldGroup>
        <Field data-invalid={hasError} data-disabled={pending}>
          <FieldLabel htmlFor="student-profile-email">이메일</FieldLabel>
          <Input
            id="student-profile-email"
            type="email"
            value={email}
            readOnly
            disabled={pending}
            autoComplete="email"
          />
        </Field>
        <Field data-invalid={hasError} data-disabled={pending}>
          <FieldLabel htmlFor="student-profile-name">이름</FieldLabel>
          <Input
            id="student-profile-name"
            name="name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            autoComplete="name"
            aria-invalid={hasError}
            aria-describedby={errorId}
            disabled={pending}
            required
          />
        </Field>
        <Field data-invalid={hasError} data-disabled={pending}>
          <FieldLabel>생년월일</FieldLabel>
          <SegmentedBirthDateInput
            value={birthDate}
            onChange={setBirthDate}
            invalid={hasError}
            describedBy={errorId}
            disabled={pending}
          />
        </Field>
        <Field data-invalid={hasError} data-disabled={pending}>
          <FieldLabel>학생 연락처</FieldLabel>
          <SegmentedPhoneInput
            label="학생 연락처"
            name="phone"
            value={phone}
            onChange={setPhone}
            autoComplete="tel"
            invalid={hasError}
            describedBy={errorId}
            disabled={pending}
          />
        </Field>
        <Field data-invalid={hasError} data-disabled={pending}>
          <FieldLabel>보호자 연락처</FieldLabel>
          <SegmentedPhoneInput
            label="보호자 연락처"
            name="guardian_phone"
            value={guardianPhone}
            onChange={setGuardianPhone}
            autoComplete="tel"
            invalid={hasError}
            describedBy={errorId}
            disabled={pending}
          />
        </Field>
        {error ? (
          <Alert id="student-profile-error" variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        <Field orientation="horizontal" data-disabled={pending}>
          <Button type="button" variant="outline" onClick={onCancel} disabled={pending}>
            취소
          </Button>
          <Button type="submit" disabled={pending}>
            {pending ? (
              <>
                <Spinner data-icon="inline-start" aria-hidden />
                저장 중
              </>
            ) : "저장"}
          </Button>
        </Field>
      </FieldGroup>
    </form>
  );
}
