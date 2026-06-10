"use client";

import { useEffect, useState } from "react";
import QRCode from "qrcode";

export type QrImageProps = { value: string; size?: number; className?: string };

/**
 * Renders `value` as a QR code on a white rounded panel (so dark-mode camera
 * scans reliably). Uses the `qrcode` package to produce a data URL.
 */
export function QrImage({ value, size = 220, className = "" }: QrImageProps) {
  const [dataUrl, setDataUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    QRCode.toDataURL(value, {
      width: size * 2, // 2x for crisp rendering on retina
      margin: 1,
      errorCorrectionLevel: "M",
      color: { dark: "#0a0e0b", light: "#ffffff" },
    })
      .then((url) => {
        if (!cancelled) setDataUrl(url);
      })
      .catch(() => {
        if (!cancelled) setDataUrl(null);
      });
    return () => {
      cancelled = true;
    };
  }, [value, size]);

  return (
    <div
      className={`inline-flex items-center justify-center border border-line bg-white p-3 shadow-[0_14px_34px_-18px_rgba(35,78,20,0.18)] ${className}`}
      style={{ borderRadius: 14, width: size + 24, height: size + 24 }}
    >
      {dataUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={dataUrl} alt="QR code" width={size} height={size} style={{ display: "block" }} />
      ) : (
        <div
          style={{ width: size, height: size, background: "color-mix(in srgb, var(--color-accent-deep) 8%, #ffffff)" }}
          className="animate-pulse rounded-lg"
        />
      )}
    </div>
  );
}
