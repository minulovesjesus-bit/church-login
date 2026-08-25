"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Camera, CheckCircle2, CircleAlert, RotateCcw } from "lucide-react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import { api, ApiClientError } from "@/lib/api/client";
import { cn } from "@/lib/utils";

import { browserQrDecoder } from "./browser-qr-decoder";

export interface QrDecoder {
  start(
    video: HTMLVideoElement,
    onDecoded: (value: string) => void,
  ): Promise<() => void>;
}

export type ScanResult = {
  scan_id: string;
  direction: "IN" | "OUT";
  scanned_at: string;
  duplicate: boolean;
  cooldown_remaining: number | null;
};

type ScanBody = { qr_token: string; request_id: string };

export interface AttendanceScanClient {
  scan(body: ScanBody): Promise<ScanResult>;
}

type QrScannerProps = {
  client?: AttendanceScanClient;
  decoder?: QrDecoder;
  createRequestId?: () => string;
};

type UiState =
  | { kind: "requesting-camera" }
  | { kind: "scanning" }
  | { kind: "submitting" }
  | { kind: "accepted"; result: ScanResult }
  | { kind: "cooldown"; result: ScanResult }
  | { kind: "camera-error"; message: string }
  | {
    kind: "scan-error";
    code: string;
    message: string;
    retryable: boolean;
  };

const defaultClient: AttendanceScanClient = {
  scan: (body) => api.post<ScanResult>("/api/attendance/scan", body),
};

function defaultRequestId(): string {
  return crypto.randomUUID();
}

function stopVideoTracks(video: HTMLVideoElement | null): void {
  const stream = video?.srcObject;
  if (stream && "getTracks" in stream) {
    stream.getTracks().forEach((track) => track.stop());
  }
  if (video) video.srcObject = null;
}

function cameraErrorMessage(error: unknown): string {
  if (error instanceof DOMException && error.name === "NotAllowedError") {
    return "카메라 권한을 허용해 주세요. 브라우저 설정에서 권한을 켠 뒤 다시 시도해 주세요.";
  }
  if (
    error instanceof DOMException
    && (error.name === "NotFoundError" || error.name === "OverconstrainedError")
  ) {
    return "사용할 수 있는 카메라를 찾지 못했어요. 카메라가 있는 다른 기기에서 시도해 주세요.";
  }
  if (typeof navigator !== "undefined" && !navigator.mediaDevices?.getUserMedia) {
    return "이 브라우저에서는 카메라 스캔을 지원하지 않아요.";
  }
  return "카메라를 시작하지 못했어요. 권한과 기기 상태를 확인한 뒤 다시 시도해 주세요.";
}

function scanError(error: unknown): Extract<UiState, { kind: "scan-error" }> {
  const code = error instanceof ApiClientError ? error.code : "NETWORK_ERROR";
  const messages: Record<string, string> = {
    QR_INVALID: "유효하지 않은 QR 코드예요.",
    QR_EXPIRED: "QR 코드가 만료됐어요.",
    KIOSK_SESSION_REVOKED: "이 기기의 QR 사용이 중지됐어요.",
    RATE_LIMITED: "요청이 너무 많아요. 잠시 후 다시 시도해 주세요.",
    AUTH_REQUIRED: "학생 로그인이 필요해요.",
    PROFILE_REQUIRED: "학생 정보를 먼저 입력해 주세요.",
    EMAIL_NOT_VERIFIED: "이메일 인증을 완료한 뒤 다시 시도해 주세요.",
    NETWORK_ERROR: "네트워크 연결을 확인한 뒤 같은 출결을 다시 전송해 주세요.",
    REQUEST_FAILED: "네트워크 연결을 확인한 뒤 같은 출결을 다시 전송해 주세요.",
  };
  return {
    kind: "scan-error",
    code,
    message: messages[code] ?? "출결을 처리하지 못했습니다. 새 QR로 다시 시도해 주세요.",
    retryable: code === "NETWORK_ERROR" || code === "REQUEST_FAILED" || code === "RATE_LIMITED",
  };
}

export function QrScanner({
  client = defaultClient,
  decoder = browserQrDecoder,
  createRequestId = defaultRequestId,
}: QrScannerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const stopRef = useRef<(() => void) | null>(null);
  const resultHeadingRef = useRef<HTMLHeadingElement>(null);
  const pendingRef = useRef<ScanBody | null>(null);
  const submittingRef = useRef(false);
  const mountedRef = useRef(false);
  const [scanCycle, setScanCycle] = useState(0);
  const [state, setState] = useState<UiState>({ kind: "requesting-camera" });

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const submit = useCallback(async (body: ScanBody) => {
    if (submittingRef.current) return;
    submittingRef.current = true;
    if (mountedRef.current) setState({ kind: "submitting" });
    try {
      const result = await client.scan(body);
      if (!mountedRef.current) return;
      if (result.cooldown_remaining !== null) {
        setState({ kind: "cooldown", result });
      } else {
        setState({ kind: "accepted", result });
      }
    } catch (error) {
      if (mountedRef.current) setState(scanError(error));
    } finally {
      submittingRef.current = false;
    }
  }, [client]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    let cancelled = false;
    let localStop: (() => void) | undefined;
    setState({ kind: "requesting-camera" });

    const onDecoded = (rawValue: string) => {
      if (cancelled || submittingRef.current || pendingRef.current) return;
      const value = rawValue.trim();
      if (!value) return;
      const body = { qr_token: value, request_id: createRequestId() };
      pendingRef.current = body;
      submittingRef.current = true;
      localStop?.();
      stopRef.current = null;
      stopVideoTracks(video);
      submittingRef.current = false;
      void submit(body);
    };

    decoder.start(video, onDecoded)
      .then((stop) => {
        if (cancelled || submittingRef.current || pendingRef.current) {
          try {
            stop();
          } finally {
            stopVideoTracks(video);
          }
          return;
        }
        localStop = stop;
        stopRef.current = stop;
        if (!submittingRef.current && !pendingRef.current) setState({ kind: "scanning" });
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          stopVideoTracks(video);
          setState({ kind: "camera-error", message: cameraErrorMessage(error) });
        }
      });

    return () => {
      cancelled = true;
      localStop?.();
      if (stopRef.current === localStop) stopRef.current = null;
      stopVideoTracks(video);
    };
  }, [createRequestId, decoder, scanCycle, submit]);

  useEffect(() => {
    if (state.kind === "accepted" || state.kind === "cooldown") {
      resultHeadingRef.current?.focus();
    }
  }, [state.kind]);

  function startFreshScan() {
    pendingRef.current = null;
    submittingRef.current = false;
    stopRef.current?.();
    stopRef.current = null;
    stopVideoTracks(videoRef.current);
    setScanCycle((value) => value + 1);
  }

  function retryPending() {
    const pending = pendingRef.current;
    if (pending) void submit(pending);
  }

  const resultTime = state.kind === "accepted"
    ? new Intl.DateTimeFormat("ko-KR", {
      hour: "numeric",
      minute: "2-digit",
      second: "2-digit",
      timeZone: "Asia/Seoul",
    }).format(new Date(state.result.scanned_at))
    : undefined;

  return (
    <Card className="scanner-card" aria-labelledby="scanner-title">
      <CardHeader className="scanner-card__intro">
        <CardTitle><h1 id="scanner-title">QR로 출결하기</h1></CardTitle>
      </CardHeader>

      <CardContent className="scanner-card__camera">
        <div className="camera-frame" data-state={state.kind}>
          <video ref={videoRef} muted playsInline aria-label="QR 스캔 카메라" />
          <div className="camera-frame__guide" aria-hidden="true" />
          {state.kind === "requesting-camera" ? (
            <div className="camera-overlay" role="status">
              <Spinner aria-hidden="true" />
              <span>카메라를 준비하고 있어요</span>
            </div>
          ) : null}
          {state.kind === "scanning" ? (
            <div className="camera-caption" role="status">
              <Camera aria-hidden="true" />
              <span>QR 코드를 화면 안에 맞춰 주세요</span>
            </div>
          ) : null}
          {state.kind === "submitting" ? (
            <div className="camera-overlay" role="status">
              <Spinner aria-hidden="true" />
              <span>출결을 전송하고 있어요</span>
            </div>
          ) : null}
        </div>
      </CardContent>

      {state.kind === "camera-error" ? (
        <div className="result-panel result-panel--error">
          <Alert variant="destructive">
            <CircleAlert aria-hidden="true" />
            <AlertDescription>{state.message}</AlertDescription>
          </Alert>
          <Button type="button" onClick={startFreshScan}>
            <RotateCcw data-icon="inline-start" />
            카메라 다시 켜기
          </Button>
        </div>
      ) : null}

      {state.kind === "accepted" ? (
        <CardFooter
          className={cn(
            "result-panel",
            state.result.direction === "IN" ? "result-panel--in" : "result-panel--out",
          )}
          role="status"
          aria-live="polite"
          aria-atomic="true"
        >
          <CheckCircle2 className="result-panel__mark" aria-hidden="true" />
          <h2 ref={resultHeadingRef} tabIndex={-1}>
            {state.result.direction === "IN" ? "입실 처리됐어요" : "퇴실 처리됐어요"}
          </h2>
          <p>{resultTime} 기준으로 저장했습니다.</p>
          {state.result.duplicate ? <p>이미 처리된 요청의 결과예요.</p> : null}
          <Button type="button" onClick={startFreshScan}>
            새 QR 스캔
          </Button>
        </CardFooter>
      ) : null}

      {state.kind === "cooldown" ? (
        <CardFooter
          className="result-panel result-panel--info"
          role="status"
          aria-live="polite"
          aria-atomic="true"
        >
          <h2 ref={resultHeadingRef} tabIndex={-1}>잠시만 기다려 주세요</h2>
          <p>{Math.ceil(state.result.cooldown_remaining ?? 0)}초 후 다시 스캔할 수 있어요.</p>
          <Button type="button" onClick={startFreshScan}>
            새 QR 스캔
          </Button>
        </CardFooter>
      ) : null}

      {state.kind === "scan-error" ? (
        <div className="result-panel result-panel--error">
          <Alert variant="destructive">
            <CircleAlert aria-hidden="true" />
            <AlertDescription>{state.message}</AlertDescription>
          </Alert>
          <div className="button-row">
            {state.retryable ? (
              <Button type="button" onClick={retryPending}>
                같은 출결 다시 전송
              </Button>
            ) : null}
            {state.code === "AUTH_REQUIRED" ? (
              <Button asChild><Link href="/login">학생 로그인</Link></Button>
            ) : (
              <Button type="button" variant="outline" onClick={startFreshScan}>
                새 QR 스캔
              </Button>
            )}
          </div>
        </div>
      ) : null}
    </Card>
  );
}
