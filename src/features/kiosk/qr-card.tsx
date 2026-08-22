"use client";

import { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";

type QrCardProps = {
  expiresAtMs: number;
  nowMs: number;
  token: string;
};

const QR_LIFETIME_MS = 20_000;
const MIN_QR_SIZE = 320;
const MAX_QR_SIZE = 520;

export function QrCard({ expiresAtMs, nowMs, token }: QrCardProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const canvasWrapRef = useRef<HTMLDivElement>(null);
  const renderGenerationRef = useRef(0);
  const [renderFailed, setRenderFailed] = useState(false);
  const [cssSize, setCssSize] = useState(MIN_QR_SIZE);

  const remainingMs = Math.max(0, expiresAtMs - nowMs);
  const remainingSeconds = Math.ceil(remainingMs / 1_000);
  const progress = Math.min(100, Math.max(0, (remainingMs / QR_LIFETIME_MS) * 100));

  useEffect(() => {
    const wrapper = canvasWrapRef.current;
    if (!wrapper) return;
    const observer = new ResizeObserver(([entry]) => {
      const availableWidth = entry?.contentRect.width;
      if (typeof availableWidth !== "number" || !Number.isFinite(availableWidth)) return;
      setCssSize(Math.min(MAX_QR_SIZE, Math.max(MIN_QR_SIZE, availableWidth)));
    });
    observer.observe(wrapper);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const visibleCanvas = canvasRef.current;
    if (!visibleCanvas) return;
    let active = true;
    const generation = renderGenerationRef.current + 1;
    renderGenerationRef.current = generation;
    setRenderFailed(false);
    const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
    const backingSize = Math.round(cssSize * pixelRatio);
    const renderCanvas = document.createElement("canvas");

    const isCurrent = () => active && renderGenerationRef.current === generation;
    const commitRender = () => {
      if (!isCurrent()) return;
      const context = visibleCanvas.getContext("2d");
      if (!context) throw new TypeError("Canvas rendering is unavailable");
      visibleCanvas.width = renderCanvas.width;
      visibleCanvas.height = renderCanvas.height;
      visibleCanvas.style.width = `${cssSize}px`;
      visibleCanvas.style.height = `${cssSize}px`;
      context.clearRect(0, 0, visibleCanvas.width, visibleCanvas.height);
      context.drawImage(renderCanvas, 0, 0);
    };

    try {
      const renderQr = QRCode.toCanvas(renderCanvas, token, {
        errorCorrectionLevel: "M",
        margin: 2,
        width: backingSize,
        color: { dark: "#202521", light: "#ffffff" },
      });
      Promise.resolve(renderQr).then(commitRender).catch(() => {
        if (isCurrent()) setRenderFailed(true);
      });
    } catch {
      if (isCurrent()) setRenderFailed(true);
    }

    return () => {
      active = false;
    };
  }, [cssSize, token]);

  return (
    <Card className="qr-card" role="region" aria-labelledby="kiosk-qr-title">
      <CardContent className="qr-card__content">
        <div ref={canvasWrapRef} className="qr-card__canvas-wrap">
          <canvas
            ref={canvasRef}
            className="qr-card__canvas"
            role="img"
            aria-label="학생 출결용 QR 코드"
            style={{ width: `${cssSize}px`, height: `${cssSize}px` }}
          />
        </div>
        <div className="qr-card__instructions">
          <div className="qr-card__header">
            <p>학생 출결</p>
            <h2 id="kiosk-qr-title">QR 코드를 스캔해 주세요</h2>
            <p>학생 앱에서 QR 출결을 열고 아래 코드를 스캔하세요.</p>
          </div>
          <div className="qr-card__timer">
            <span className="countdown">{remainingSeconds}초 후 갱신</span>
            <Progress
              value={progress}
              aria-label="QR 코드 유효 시간"
              aria-valuenow={progress}
            />
          </div>
          {renderFailed ? (
            <Alert variant="destructive">
              <AlertDescription>
                QR 화면을 그리지 못했습니다. 잠시 후 자동으로 다시 시도합니다.
              </AlertDescription>
            </Alert>
          ) : null}
          <p className="qr-card__hint">
            스캔할 때마다 입실과 퇴실이 번갈아 기록됩니다.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
