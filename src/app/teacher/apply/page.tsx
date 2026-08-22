"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";

import { AuthShell } from "@/components/layout/auth-shell";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { api, ApiClientError } from "@/lib/api/client";

type ApplicationStatus = "none" | "pending" | "rejected" | "approved";
type ApplicationStateResponse = {
  status: ApplicationStatus;
  rejection_reason: string | null;
};

const digitsOnly = (value: string) => value.replace(/\D/g, "");

function TeacherApplicationForm({ resubmission = false, onPending }: {
  resubmission?: boolean;
  onPending: () => void;
}) {
  const [error, setError] = useState<string>();
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError(undefined);
    const form = new FormData(event.currentTarget);
    try {
      await api.post("/api/teacher-applications", {
        name: String(form.get("name") ?? "").trim(),
        phone: digitsOnly(String(form.get("phone") ?? "")),
      });
      onPending();
    } catch (caught) {
      setError(caught instanceof ApiClientError ? caught.message : "교사 가입을 신청하지 못했습니다.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={submit}>
      <FieldGroup>
        <Field data-invalid={Boolean(error)} data-disabled={submitting}>
          <FieldLabel htmlFor="teacher-application-name">이름</FieldLabel>
          <Input
            id="teacher-application-name"
            name="name"
            autoComplete="name"
            aria-invalid={Boolean(error)}
            aria-describedby={error ? "teacher-application-error" : undefined}
            disabled={submitting}
            required
            maxLength={80}
          />
        </Field>
        <Field data-invalid={Boolean(error)} data-disabled={submitting}>
          <FieldLabel htmlFor="teacher-application-phone">연락처</FieldLabel>
          <Input
            id="teacher-application-phone"
            name="phone"
            type="tel"
            inputMode="numeric"
            autoComplete="tel"
            aria-invalid={Boolean(error)}
            aria-describedby={error ? "teacher-application-error" : undefined}
            disabled={submitting}
            required
          />
        </Field>
        {error ? (
          <Alert id="teacher-application-error" variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        <Button type="submit" className="w-full" disabled={submitting}>
          {submitting ? (
            <>
              <Spinner data-icon="inline-start" aria-hidden />
              신청 중
            </>
          ) : resubmission ? "다시 신청" : "교사 가입 신청"}
        </Button>
      </FieldGroup>
    </form>
  );
}

export function ApplicationState({
  status,
  rejectionReason,
  onPending,
}: {
  status: ApplicationStatus;
  rejectionReason?: string | null;
  onPending: () => void;
}) {
  if (status === "pending") return <p role="status">교사 가입 승인을 기다리고 있습니다.</p>;
  if (status === "rejected") {
    return (
      <div className="flex flex-col gap-5">
        <Alert variant="destructive">
          <AlertTitle>신청이 거절되었습니다. 정보를 확인해 다시 신청할 수 있습니다.</AlertTitle>
          {rejectionReason ? (
            <AlertDescription>거절 사유: {rejectionReason}</AlertDescription>
          ) : null}
        </Alert>
        <TeacherApplicationForm resubmission onPending={onPending} />
      </div>
    );
  }
  if (status === "approved") {
    return (
      <Button asChild className="w-full">
        <Link href="/teacher">교사 대시보드로 이동</Link>
      </Button>
    );
  }
  return <TeacherApplicationForm onPending={onPending} />;
}

export default function TeacherApplicationPage() {
  const [state, setState] = useState<ApplicationStateResponse>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    let active = true;
    api.get<ApplicationStateResponse>("/api/teacher-applications/me")
      .then((response) => {
        if (active) setState(response);
      })
      .catch((caught) => {
        if (active) {
          setError(caught instanceof ApiClientError ? caught.message : "신청 상태를 확인하지 못했습니다.");
        }
      });
    return () => {
      active = false;
    };
  }, []);

  return (
    <AuthShell title="교사 가입 신청">
      <Card className="w-full">
        <CardHeader>
          <CardTitle>신청 상태</CardTitle>
        </CardHeader>
        <CardContent>
          {error ? (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
          {!state && !error ? <p role="status">신청 상태를 확인하고 있습니다.</p> : null}
          {state ? (
            <ApplicationState
              status={state.status}
              rejectionReason={state.rejection_reason}
              onPending={() => setState({ status: "pending", rejection_reason: null })}
            />
          ) : null}
        </CardContent>
      </Card>
    </AuthShell>
  );
}
