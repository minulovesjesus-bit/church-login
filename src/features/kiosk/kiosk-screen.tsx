"use client";

import { FormEvent, useEffect, useRef, useState } from "react";

import { ApiClientError } from "@/lib/api/client";
import {
  kioskApi,
  type KioskQrChallenge,
  type KioskSession,
} from "@/lib/api/kiosk-client";

import { QrCard } from "./qr-card";

export interface KioskClient {
  login(password: string): Promise<KioskSession>;
  refresh(): Promise<KioskSession>;
  getQr(): Promise<KioskQrChallenge>;
  logout(): Promise<void>;
}

type KioskScreenProps = {
  client?: KioskClient;
};

type ConnectionState = "connecting" | "connected" | "retrying";
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

export function KioskScreen({ client = kioskApi }: KioskScreenProps) {
  const [unlocked, setUnlocked] = useState(false);
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [loginError, setLoginError] = useState<string>();
  const [lockedNotice, setLockedNotice] = useState<string>();
  const [challenge, setChallenge] = useState<KioskQrChallenge>();
  const [remainingSeconds, setRemainingSeconds] = useState(0);
  const [connection, setConnection] = useState<ConnectionState>("connecting");

  useEffect(() => {
    if (!unlocked) return;

    let active = true;
    let inFlight = false;
    let retrying = false;
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
      setRemainingSeconds(Math.max(0, Math.ceil((expiresAt - Date.now()) / 1_000)));
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
        setRemainingSeconds(0);
      }
      setConnection("connecting");
      try {
        const nextChallenge = await fetchQrWithRefresh();
        if (!active) return;
        const nextExpiry = usableChallengeExpiry(nextChallenge, Date.now());
        expiresAt = nextExpiry;
        retryAttempt = 0;
        retrying = false;
        setChallenge(nextChallenge);
        setConnection("connected");
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
          setPassword("");
          setLockedNotice("기기 세션이 종료되었습니다. 관리자 비밀번호를 다시 입력해 주세요.");
          setUnlocked(false);
          return;
        }
        retrying = true;
        if (expiresAt <= Date.now()) {
          clearCountdown();
          setChallenge(undefined);
          setRemainingSeconds(0);
        }
        setConnection("retrying");
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
  }, [client, unlocked]);

  async function handleLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!password || submitting) return;
    setSubmitting(true);
    setLoginError(undefined);
    setLockedNotice(undefined);
    try {
      await client.login(password);
      setPassword("");
      setChallenge(undefined);
      setConnection("connecting");
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

  async function handleReset() {
    if (resetting) return;
    setResetting(true);
    try {
      try {
        await client.logout();
      } catch (error) {
        if (!isSessionError(error)) throw error;
        await client.refresh();
        await client.logout();
      }
      setLockedNotice("기기 세션을 안전하게 초기화했습니다.");
    } catch {
      setLockedNotice("기기 화면을 잠갔습니다. 다시 사용하려면 비밀번호를 입력해 주세요.");
    } finally {
      setChallenge(undefined);
      setPassword("");
      setUnlocked(false);
      setResetting(false);
    }
  }

  if (!unlocked) {
    return (
      <main className="kiosk-shell">
        <section className="kiosk-login-card" aria-labelledby="kiosk-login-title">
          <p className="eyebrow">교회 공용 기기</p>
          <h1 id="kiosk-login-title">출결 QR 기기</h1>
          <p className="supporting-copy">
            관리자 비밀번호를 입력하면 학생들이 스캔할 수 있는 출결 QR이 표시됩니다.
          </p>
          {lockedNotice ? <p role="status" className="notice">{lockedNotice}</p> : null}
          <form onSubmit={handleLogin} className="stack-form">
            <label htmlFor="kiosk-password">관리자 비밀번호</label>
            <input
              id="kiosk-password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              aria-describedby={loginError ? "kiosk-login-error" : undefined}
            />
            {loginError ? (
              <p id="kiosk-login-error" role="alert" className="inline-alert">
                {loginError}
              </p>
            ) : null}
            <button className="primary-button" type="submit" disabled={submitting}>
              {submitting ? "확인하고 있어요…" : "QR 화면 열기"}
            </button>
          </form>
        </section>
      </main>
    );
  }

  return (
    <main className="kiosk-shell kiosk-shell--unlocked">
      <div className="kiosk-toolbar">
        <span className={`connection-pill connection-pill--${connection}`} role="status">
          <span aria-hidden="true" className="connection-pill__dot" />
          {connection === "connected"
            ? "QR 연결됨"
            : connection === "retrying"
              ? "연결을 다시 시도하고 있어요"
              : "QR을 준비하고 있어요"}
        </span>
        <button
          type="button"
          className="quiet-button"
          onClick={handleReset}
          disabled={resetting}
        >
          {resetting ? "초기화 중…" : "기기 세션 초기화"}
        </button>
      </div>
      {challenge ? (
        <QrCard token={challenge.token} remainingSeconds={remainingSeconds} />
      ) : (
        <section className="qr-card qr-card--loading" aria-live="polite">
          <div className="qr-placeholder" aria-hidden="true" />
          <h1>안전한 QR을 준비하고 있어요</h1>
          <p>잠시만 기다려 주세요.</p>
        </section>
      )}
    </main>
  );
}
