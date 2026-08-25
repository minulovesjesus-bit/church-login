"use client";

import { FormEvent, useEffect, useState } from "react";

import { BrandLockup } from "@/components/brand/brand-mark";
import { KioskShell } from "@/components/layout/kiosk-shell";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { ApiClientError } from "@/lib/api/client";
import {
  kioskApi,
  type KioskQrChallenge,
  type KioskSession,
} from "@/lib/api/kiosk-client";

import { QrCard } from "./qr-card";

export interface KioskClient {
  login(deviceName: string, password: string): Promise<KioskSession>;
  refresh(): Promise<KioskSession>;
  getQr(): Promise<KioskQrChallenge>;
}

type KioskScreenProps = {
  client?: KioskClient;
  onSessionInvalidated?: (destination: "/qr") => void;
};

const RETRY_DELAYS_MS = [1_000, 2_000, 4_000, 8_000] as const;
const QR_LIFETIME_MS = 20_000;

function usableChallengeExpiry(challenge: KioskQrChallenge, now: number): number {
  const issuedAt = Date.parse(challenge.issued_at);
  const expiresAt = Date.parse(challenge.expires_at);
  const lifetime = expiresAt - issuedAt;
  const remaining = expiresAt - now;
  if (
    !challenge.token.trim()
    || !Number.isFinite(issuedAt)
    || !Number.isFinite(expiresAt)
    || lifetime !== QR_LIFETIME_MS
    || remaining <= 0
    || remaining > QR_LIFETIME_MS
  ) {
    throw new TypeError("Unusable QR challenge");
  }
  return expiresAt;
}

function isSessionError(error: unknown): boolean {
  return error instanceof ApiClientError
    && (error.code === "KIOSK_SESSION_REVOKED" || error.code === "AUTH_REQUIRED");
}

function replaceWithLockedQr(destination: "/qr") {
  window.location.replace(destination);
}

export function KioskScreen({
  client = kioskApi,
  onSessionInvalidated = replaceWithLockedQr,
}: KioskScreenProps) {
  const [unlocked, setUnlocked] = useState(false);
  const [deviceName, setDeviceName] = useState("");
  const [activeDeviceName, setActiveDeviceName] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [loginError, setLoginError] = useState<string>();
  const [challenge, setChallenge] = useState<KioskQrChallenge>();
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [announcement, setAnnouncement] = useState("");

  useEffect(() => {
    if (!unlocked) return;

    let active = true;
    let inFlight = false;
    let retrying = false;
    let awaitingReplacement = false;
    let retryAttempt = 0;
    let expiresAt = 0;
    let issueTimer: number | undefined;
    let countdownTimer: number | undefined;

    const clearIssueTimer = () => {
      if (issueTimer !== undefined) window.clearTimeout(issueTimer);
      issueTimer = undefined;
    };

    const clearCountdown = () => {
      if (countdownTimer !== undefined) window.clearInterval(countdownTimer);
      countdownTimer = undefined;
    };

    const updateCountdown = () => {
      if (!active) return;
      setNowMs(Date.now());
    };

    const scheduleAtExpiry = (requestQr: () => Promise<void>) => {
      clearIssueTimer();
      const delay = Math.max(0, expiresAt - Date.now());
      issueTimer = window.setTimeout(() => void requestQr(), delay);
    };

    async function fetchQrWithRefresh(): Promise<KioskQrChallenge> {
      try {
        return await client.getQr();
      } catch (error) {
        if (!isSessionError(error)) throw error;
        await client.refresh();
        return client.getQr();
      }
    }

    async function requestQr(): Promise<void> {
      if (!active || inFlight) return;
      if (document.visibilityState === "hidden") return;
      inFlight = true;
      clearIssueTimer();
      if (expiresAt > 0 && expiresAt <= Date.now()) {
        clearCountdown();
        setChallenge(undefined);
        setNowMs(Date.now());
        if (!awaitingReplacement) {
          setAnnouncement("QR 코드가 만료되었습니다. 새 QR을 준비하고 있어요.");
          awaitingReplacement = true;
        }
      }
      try {
        const nextChallenge = await fetchQrWithRefresh();
        if (!active) return;
        const nextExpiry = usableChallengeExpiry(nextChallenge, Date.now());
        expiresAt = nextExpiry;
        retryAttempt = 0;
        const recovered = retrying;
        const replacedExpiredQr = awaitingReplacement;
        retrying = false;
        awaitingReplacement = false;
        setChallenge(nextChallenge);
        setAnnouncement(
          recovered
            ? "QR 연결이 복구되고 새 QR 코드가 준비됐습니다."
            : replacedExpiredQr
              ? "새 QR 코드가 준비됐습니다."
              : "",
        );
        clearCountdown();
        updateCountdown();
        countdownTimer = window.setInterval(updateCountdown, 1_000);
        scheduleAtExpiry(requestQr);
      } catch (error) {
        if (!active) return;
        if (isSessionError(error)) {
          clearIssueTimer();
          clearCountdown();
          setChallenge(undefined);
          onSessionInvalidated("/qr");
          return;
        }
        retrying = true;
        if (expiresAt <= Date.now()) {
          clearCountdown();
          setChallenge(undefined);
          setNowMs(Date.now());
        }
        setAnnouncement("QR 연결이 끊어졌습니다. 연결을 다시 시도하고 있어요.");
        const delay = RETRY_DELAYS_MS[Math.min(retryAttempt, RETRY_DELAYS_MS.length - 1)];
        retryAttempt += 1;
        issueTimer = window.setTimeout(() => void requestQr(), delay);
      } finally {
        inFlight = false;
      }
    }

    const handleVisibility = () => {
      if (document.visibilityState === "hidden") {
        clearIssueTimer();
        return;
      }
      if (expiresAt > Date.now()) scheduleAtExpiry(requestQr);
      else void requestQr();
    };

    const handleOnline = () => {
      if (retrying) {
        clearIssueTimer();
        void requestQr();
      }
    };

    document.addEventListener("visibilitychange", handleVisibility);
    window.addEventListener("online", handleOnline);
    void requestQr();

    return () => {
      active = false;
      clearIssueTimer();
      clearCountdown();
      document.removeEventListener("visibilitychange", handleVisibility);
      window.removeEventListener("online", handleOnline);
    };
  }, [client, onSessionInvalidated, unlocked]);

  async function handleLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalizedDeviceName = deviceName.trim();
    if (!normalizedDeviceName || !password || submitting) return;
    setSubmitting(true);
    setLoginError(undefined);
    try {
      const session = await client.login(normalizedDeviceName, password);
      setActiveDeviceName(session.device_name);
      setDeviceName(normalizedDeviceName);
      setPassword("");
      setChallenge(undefined);
      setAnnouncement("");
      setUnlocked(true);
    } catch (error) {
      setLoginError(
        error instanceof ApiClientError && error.code === "KIOSK_LOGIN_FAILED"
          ? "관리자 비밀번호를 확인해 주세요."
          : "서버에 연결하지 못했습니다. 인터넷 연결을 확인한 뒤 다시 시도해 주세요.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  if (!unlocked) {
    return (
      <KioskShell mode="locked">
        <Card className="kiosk-login-card" aria-labelledby="kiosk-login-title">
          <CardHeader>
            <BrandLockup />
            <CardTitle><h1 id="kiosk-login-title">출결 QR 기기</h1></CardTitle>
            <CardDescription>
              기기 이름과 관리자 비밀번호를 입력하면 학생들이 스캔할 수 있는 출결 QR이 표시됩니다.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleLogin} className="kiosk-login-form">
              <FieldGroup>
                <Field>
                  <FieldLabel htmlFor="kiosk-device-name">기기 이름</FieldLabel>
                  <Input
                    id="kiosk-device-name"
                    name="deviceName"
                    type="text"
                    autoComplete="off"
                    maxLength={80}
                    required
                    value={deviceName}
                    onChange={(event) => setDeviceName(event.target.value)}
                    placeholder="예: 본당 입구 태블릿"
                  />
                </Field>
                <Field data-invalid={Boolean(loginError)}>
                  <FieldLabel htmlFor="kiosk-password">관리자 비밀번호</FieldLabel>
                  <Input
                    id="kiosk-password"
                    name="password"
                    type="password"
                    autoComplete="current-password"
                    required
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    aria-invalid={Boolean(loginError)}
                    aria-describedby={loginError ? "kiosk-login-error" : undefined}
                  />
                  {loginError ? (
                    <FieldError id="kiosk-login-error">{loginError}</FieldError>
                  ) : null}
                </Field>
                <Button type="submit" disabled={submitting}>
                  {submitting ? <Spinner data-icon="inline-start" aria-label="확인 중" /> : null}
                  {submitting ? "확인하고 있어요…" : "QR 화면 열기"}
                </Button>
              </FieldGroup>
            </form>
          </CardContent>
        </Card>
      </KioskShell>
    );
  }

  return (
    <KioskShell
      mode="unlocked"
      toolbar={(
        <span className="kiosk-device-name">{activeDeviceName}</span>
      )}
    >
      <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {announcement}
      </p>
      {challenge ? (
        <QrCard
          token={challenge.token}
          expiresAtMs={Date.parse(challenge.expires_at)}
          nowMs={nowMs}
        />
      ) : (
        <Card className="qr-card qr-card--loading">
          <Skeleton className="qr-placeholder" aria-hidden="true" />
          <h1>안전한 QR을 준비하고 있어요</h1>
          <p>잠시만 기다려 주세요.</p>
        </Card>
      )}
    </KioskShell>
  );
}
