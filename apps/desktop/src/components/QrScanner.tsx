import jsQR from "jsqr";
import { X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Button, IconButton } from "./ui";

/**
 * Camera QR scanner. Decoding happens locally frame by frame; nothing is
 * uploaded. If no camera is available the caller still offers manual entry.
 */
export function QrScanner({ onDecode, onClose }: { onDecode: (text: string) => void; onClose: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let stream: MediaStream | null = null;
    let frame = 0;
    let cancelled = false;
    const canvas = document.createElement("canvas");

    const start = async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setError("This system does not expose a camera to the app. Paste the setup code instead.");
        return;
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
      } catch {
        setError("The camera could not be opened. Paste the setup code instead.");
        return;
      }
      const video = videoRef.current;
      if (!video || cancelled) return;
      video.srcObject = stream;
      await video.play().catch(() => undefined);

      const tick = () => {
        if (cancelled) return;
        const current = videoRef.current;
        if (current && current.videoWidth > 0) {
          canvas.width = current.videoWidth;
          canvas.height = current.videoHeight;
          const context = canvas.getContext("2d", { willReadFrequently: true });
          if (context) {
            context.drawImage(current, 0, 0, canvas.width, canvas.height);
            const image = context.getImageData(0, 0, canvas.width, canvas.height);
            const found = jsQR(image.data, image.width, image.height, { inversionAttempts: "dontInvert" });
            if (found?.data) {
              onDecode(found.data);
              return;
            }
          }
        }
        frame = requestAnimationFrame(tick);
      };
      frame = requestAnimationFrame(tick);
    };

    void start();
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
      stream?.getTracks().forEach((track) => track.stop());
    };
  }, [onDecode]);

  return (
    <div className="rounded-xl border border-border bg-surface p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[12.5px] font-medium">Scan a QR code</p>
        <IconButton aria-label="Close scanner" onClick={onClose}>
          <X className="h-4 w-4" />
        </IconButton>
      </div>
      <div className="mt-2 overflow-hidden rounded-lg bg-black">
        <video ref={videoRef} className="h-52 w-full object-cover" muted playsInline />
      </div>
      {error ? (
        <p className="mt-2 text-[11.5px] leading-relaxed text-muted-foreground">{error}</p>
      ) : (
        <p className="mt-2 text-[11.5px] text-muted-foreground">
          Point the camera at the code. Frames are decoded on this device.
        </p>
      )}
      <Button variant="secondary" size="sm" className="mt-2" onClick={onClose}>
        Cancel
      </Button>
    </div>
  );
}
