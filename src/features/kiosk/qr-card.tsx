"use client";

import { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";

type QrCardProps = {
  token: string;
  remainingSeconds: number;
};

export function QrCard({ token, remainingSeconds }: QrCardProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [renderFailed, setRenderFailed] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let active = true;
    setRenderFailed(false);
    QRCode.toCanvas(canvas, token, {
      errorCorrectionLevel: "M",
      margin: 2,
      width: 320,
      color: { dark: "#10251c", light: "#ffffff" },
    }).catch(() => {
      if (active) setRenderFailed(true);
    });
    return () => {
      active = false;
    };
  }, [token]);

  return (
    <section className="qr-card" aria-labelledby="kiosk-qr-title">
      <div className="qr-card__header">
        <div>
          <p className="eyebrow">학생 출결</p>
          <h2 id="kiosk-qr-title">QR 코드를 스캔해 주세요</h2>
        </div>
        <span className="countdown" aria-live="polite">
          {remainingSeconds}초 후 갱신
        </span>
      </div>
      <div className="qr-card__canvas-wrap">
        <canvas
          ref={canvasRef}
          className="qr-card__canvas"
          role="img"
          aria-label="학생 출결용 QR 코드"
        />
      </div>
      {renderFailed ? (
        <p role="alert" className="inline-alert">
          QR 화면을 그리지 못했습니다. 잠시 후 자동으로 다시 시도합니다.
        </p>
      ) : null}
      <p className="qr-card__hint">
        학생 계정으로 로그인한 뒤 휴대폰의 QR 스캔 버튼을 눌러 주세요.
      </p>
    </section>
  );
}
