"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

import {
  birthDateValue,
  SegmentedBirthDateInput,
  SegmentedPhoneInput,
  type BirthDateParts,
} from "@/components/forms/segmented-inputs";
import { AuthShell } from "@/components/layout/auth-shell";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { api, ApiClientError } from "@/lib/api/client";

const digitsOnly = (value: string) => value.replace(/\D/g, "");

function ageFromBirthDate(value: string): number | undefined {
  if (!value) return undefined;
  const birthDate = new Date(`${value}T00:00:00`);
  if (Number.isNaN(birthDate.getTime())) return undefined;
  const today = new Date();
  let age = today.getFullYear() - birthDate.getFullYear();
  const birthdayHasNotArrived =
    today.getMonth() < birthDate.getMonth() ||
    (today.getMonth() === birthDate.getMonth() && today.getDate() < birthDate.getDate());
  if (birthdayHasNotArrived) age -= 1;
  return age >= 0 ? age : undefined;
}

export default function OnboardingPage() {
  const router = useRouter();
  const [error, setError] = useState<string>();
  const [completed, setCompleted] = useState(false);
  const [birthDate, setBirthDate] = useState<BirthDateParts>({
    year: "",
    month: "",
    day: "",
  });
  const [submitting, setSubmitting] = useState(false);
  const age = ageFromBirthDate(birthDateValue(birthDate));

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError(undefined);
    const form = new FormData(event.currentTarget);
    try {
      await api.post("/api/students/profile", {
        name: String(form.get("name") ?? "").trim(),
        birth_date: String(form.get("birth_date") ?? ""),
        phone: digitsOnly(String(form.get("phone") ?? "")),
        guardian_phone: digitsOnly(String(form.get("guardian_phone") ?? "")),
      });
      setCompleted(true);
      router.push("/student");
    } catch (caught) {
      setError(caught instanceof ApiClientError ? caught.message : "가입을 완료하지 못했습니다.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthShell
      title="기본 정보 등록"
      description="모든 계정은 출결에 필요한 기본 정보를 먼저 등록합니다."
    >
      <Card className="w-full">
        <CardHeader>
          <CardTitle>학생 정보</CardTitle>
          <CardDescription>
            교사 권한이 추가되어도 이 정보와 출결 기록은 그대로 유지됩니다. 나이는 생년월일을 기준으로 계산합니다.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit}>
            <FieldGroup>
              <Field data-invalid={Boolean(error)} data-disabled={submitting}>
                <FieldLabel htmlFor="onboarding-name">이름</FieldLabel>
                <Input
                  id="onboarding-name"
                  name="name"
                  autoComplete="name"
                  aria-invalid={Boolean(error)}
                  aria-describedby={error ? "onboarding-error" : undefined}
                  disabled={submitting}
                  required
                />
              </Field>
              <Field data-invalid={Boolean(error)} data-disabled={submitting}>
                <FieldLabel>생년월일</FieldLabel>
                <SegmentedBirthDateInput
                  value={birthDate}
                  onChange={setBirthDate}
                  invalid={Boolean(error)}
                  describedBy={error ? "onboarding-error" : undefined}
                  disabled={submitting}
                />
                {age !== undefined ? <FieldDescription>만 {age}세</FieldDescription> : null}
              </Field>
              <Field data-invalid={Boolean(error)} data-disabled={submitting}>
                <FieldLabel>학생 연락처</FieldLabel>
                <SegmentedPhoneInput
                  label="학생 연락처"
                  name="phone"
                  autoComplete="tel"
                  invalid={Boolean(error)}
                  describedBy={error ? "onboarding-error" : undefined}
                  disabled={submitting}
                />
              </Field>
              <Field data-invalid={Boolean(error)} data-disabled={submitting}>
                <FieldLabel>보호자 연락처</FieldLabel>
                <SegmentedPhoneInput
                  label="보호자 연락처"
                  name="guardian_phone"
                  invalid={Boolean(error)}
                  describedBy={error ? "onboarding-error" : undefined}
                  disabled={submitting}
                />
              </Field>
              {error ? (
                <Alert id="onboarding-error" variant="destructive">
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              ) : null}
              {completed ? (
                <Alert role="status">
                  <AlertDescription>가입이 완료되었습니다.</AlertDescription>
                </Alert>
              ) : null}
              <Button type="submit" className="w-full" disabled={submitting}>
                {submitting ? (
                  <>
                    <Spinner data-icon="inline-start" aria-hidden />
                    저장 중
                  </>
                ) : "가입 완료"}
              </Button>
            </FieldGroup>
          </form>
        </CardContent>
      </Card>
    </AuthShell>
  );
}
