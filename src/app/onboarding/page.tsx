"use client";

import { useState, type FormEvent } from "react";

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
  const [error, setError] = useState<string>();
  const [completed, setCompleted] = useState(false);
  const [birthDate, setBirthDate] = useState("");
  const age = ageFromBirthDate(birthDate);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
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
    } catch (caught) {
      setError(caught instanceof ApiClientError ? caught.message : "가입을 완료하지 못했습니다.");
    }
  }

  return (
    <main>
      <h1>학생 정보 등록</h1>
      <p>나이는 생년월일을 기준으로 화면에서만 계산됩니다.</p>
      <form onSubmit={submit}>
        <label>
          이름
          <input name="name" required />
        </label>
        <label>
          생년월일
          <input name="birth_date" type="date" value={birthDate} onChange={(event) => setBirthDate(event.target.value)} required />
        </label>
        {age !== undefined ? <p>만 {age}세</p> : null}
        <label>
          학생 연락처
          <input name="phone" inputMode="numeric" required />
        </label>
        <label>
          보호자 연락처
          <input name="guardian_phone" inputMode="numeric" required />
        </label>
        {error ? <p role="alert">{error}</p> : null}
        {completed ? <p role="status">가입이 완료되었습니다.</p> : null}
        <button type="submit">가입 완료</button>
      </form>
    </main>
  );
}
