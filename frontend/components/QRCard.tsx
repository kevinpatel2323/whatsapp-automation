"use client";

import { useEffect, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { CheckCircle2, Smartphone } from "lucide-react";

type Props = {
  qr: string | null;
  connected: boolean;
};

export function QRCard({ qr, connected }: Props) {
  const [visible, setVisible] = useState(false);
  const [qrSize, setQrSize] = useState(200);

  useEffect(() => {
    const pick = () => {
      const w = window.innerWidth;
      if (w < 380) return 148;
      if (w < 480) return 168;
      return 200;
    };
    const sync = () => setQrSize(pick());
    sync();
    window.addEventListener("resize", sync);
    return () => window.removeEventListener("resize", sync);
  }, []);

  useEffect(() => {
    if (qr && !connected) {
      setVisible(false);
      const id = requestAnimationFrame(() => setVisible(true));
      return () => cancelAnimationFrame(id);
    }
    setVisible(false);
  }, [qr, connected]);

  return (
    <div className="flex min-h-[200px] flex-col items-center justify-center gap-3 sm:min-h-[240px]">
      {connected ? (
        <div className="flex flex-col items-center gap-3 py-2 text-center">
          <CheckCircle2
            className="h-16 w-16 text-neon-green sm:h-20 sm:w-20"
            strokeWidth={1.25}
            aria-hidden
          />
          <div>
            <p className="text-base font-semibold text-white">WhatsApp linked</p>
            <p className="mt-1 text-sm text-muted-text">Session is active · messages stream live</p>
          </div>
        </div>
      ) : qr ? (
        <div
          className={`flex flex-col items-center gap-4 transition-opacity duration-500 ${
            visible ? "opacity-100" : "opacity-0"
          }`}
        >
          <div className="rounded-2xl bg-white p-3 shadow-lg ring-1 ring-black/5">
            <QRCodeSVG value={qr} size={qrSize} level="M" />
          </div>
          <p className="max-w-[260px] text-center text-xs leading-relaxed text-muted-text sm:text-sm">
            WhatsApp → Settings → Linked devices → Link a device, then scan this code.
          </p>
        </div>
      ) : (
        <div className="flex flex-col items-center gap-3 px-2 py-4 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-card-border bg-dark-forest/80">
            <Smartphone className="h-7 w-7 text-neon-green/80" aria-hidden />
          </div>
          <div>
            <p className="text-sm font-medium text-white sm:text-base">Link this device</p>
            <p className="mt-1 text-xs text-muted-text sm:text-sm">
              Tap <span className="font-semibold text-white">Connect</span> above to show a QR code.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
