/**
 * Live selfie capture — getUserMedia ONLY (no file input / gallery picker).
 *
 * States: requesting → ready (live preview) → captured (preview with
 * retake/use) — or denied / unavailable with explicit messaging. All media
 * tracks are stopped on unmount, on cancel, and after capture.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Icon, PillButton } from "./ui";

export const SELFIE_MAX_EDGE = 720;
export const SELFIE_JPEG_QUALITY = 0.72;

type CameraStatus = "requesting" | "ready" | "captured" | "denied" | "unavailable";

export interface CameraCaptureProps {
  /** Called with a downscaled JPEG data URL when the user taps "Use photo". */
  onCapture: (dataUrl: string) => void;
  /** Called when the user backs out of the camera step. */
  onCancel: () => void;
  /** Label for the final submit button (default "Use photo"). */
  confirmLabel?: string;
}

function downscaleToDataUrl(video: HTMLVideoElement): string {
  const maxEdge = SELFIE_MAX_EDGE;
  const scale = Math.min(1, maxEdge / Math.max(video.videoWidth, video.videoHeight));
  const w = Math.max(1, Math.round(video.videoWidth * scale));
  const h = Math.max(1, Math.round(video.videoHeight * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas unsupported");
  // Mirror the preview (front camera) so the captured image matches what the
  // user saw; the preview video element is mirrored with CSS too.
  ctx.translate(w, 0);
  ctx.scale(-1, 1);
  ctx.drawImage(video, 0, 0, w, h);
  return canvas.toDataURL("image/jpeg", SELFIE_JPEG_QUALITY);
}

export function CameraCapture({ onCapture, onCancel, confirmLabel = "Use photo" }: CameraCaptureProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [status, setStatus] = useState<CameraStatus>("requesting");
  const [errorDetail, setErrorDetail] = useState<string>("");
  const [capturedUrl, setCapturedUrl] = useState<string | null>(null);

  const stopTracks = useCallback(() => {
    if (streamRef.current) {
      for (const track of streamRef.current.getTracks()) track.stop();
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  }, []);

  const startCamera = useCallback(async () => {
    setStatus("requesting");
    setErrorDetail("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => {});
      }
      setStatus("ready");
    } catch (err) {
      if (err instanceof DOMException && (err.name === "NotAllowedError" || err.name === "PermissionDeniedError")) {
        setStatus("denied");
        setErrorDetail("Camera permission was denied. Enable camera access for this site in your browser settings, then try again.");
      } else if (err instanceof DOMException && (err.name === "NotFoundError" || err.name === "OverconstrainedError")) {
        setStatus("unavailable");
        setErrorDetail("No usable camera was found on this device.");
      } else {
        setStatus("unavailable");
        setErrorDetail("The camera could not be started. Check that another app is not using it, then retry.");
      }
    }
  }, []);

  useEffect(() => {
    void startCamera();
    return stopTracks; // stop tracks on unmount / exit — always
  }, [startCamera, stopTracks]);

  const capture = useCallback(() => {
    const video = videoRef.current;
    if (!video || video.videoWidth === 0) return;
    try {
      const dataUrl = downscaleToDataUrl(video);
      setCapturedUrl(dataUrl);
      setStatus("captured");
      stopTracks();
    } catch {
      setStatus("unavailable");
      setErrorDetail("Could not capture the camera image on this device.");
    }
  }, [stopTracks]);

  return (
    <div className="space-y-4">
      {/* Live preview / captured photo */}
      <div className="relative aspect-[3/4] w-full overflow-hidden rounded-2xl bg-slate-900">
        {status === "requesting" && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-white/80">
            <span className="h-8 w-8 animate-spin rounded-full border-2 border-white/30 border-t-white" />
            <p className="text-xs font-medium">Starting camera…</p>
          </div>
        )}
        {status === "ready" && (
          <video
            ref={videoRef}
            playsInline
            muted
            autoPlay
            className="h-full w-full object-cover"
            style={{ transform: "scaleX(-1)" }}
            aria-label="Live selfie preview"
          />
        )}
        {status === "captured" && capturedUrl && (
          <img src={capturedUrl} alt="Captured selfie preview" className="h-full w-full object-cover" />
        )}
        {(status === "denied" || status === "unavailable") && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-6 text-center text-white">
            <span className="grid h-12 w-12 place-items-center rounded-full bg-white/10">
              <Icon name="lock" className="h-6 w-6" />
            </span>
            <p className="text-sm font-semibold">{status === "denied" ? "Camera permission needed" : "Camera unavailable"}</p>
            <p className="text-xs leading-relaxed text-white/70">{errorDetail}</p>
            <PillButton variant="secondary" className="mt-1" onClick={() => void startCamera()}>
              Try again
            </PillButton>
          </div>
        )}
      </div>

      {/* Controls */}
      {status === "ready" && (
        <div className="flex items-center justify-center gap-4">
          <button
            type="button"
            onClick={onCancel}
            className="min-h-11 rounded-full px-5 text-sm font-semibold text-slate-600 active:bg-slate-100"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={capture}
            aria-label="Capture selfie"
            className="grid h-16 w-16 place-items-center rounded-full bg-[#0b2b22] ring-4 ring-[#0b2b22]/20 active:scale-95"
          >
            <span className="h-11 w-11 rounded-full border-4 border-[#c8f169]" />
          </button>
        </div>
      )}
      {status === "captured" && (
        <div className="flex items-center justify-center gap-3">
          <PillButton variant="ghost" onClick={() => {
            setCapturedUrl(null);
            setStatus("ready");
            void startCamera();
          }}>
            Retake
          </PillButton>
          <PillButton
            variant="primary"
            onClick={() => {
              if (capturedUrl) onCapture(capturedUrl);
            }}
          >
            <Icon name="check" className="h-4 w-4" /> {confirmLabel}
          </PillButton>
        </div>
      )}
      {(status === "denied" || status === "unavailable") && (
        <button
          type="button"
          onClick={onCancel}
          className="w-full text-center text-sm font-semibold text-slate-500 underline underline-offset-2"
        >
          Back to consent
        </button>
      )}
      <p className="text-center text-[11px] leading-relaxed text-slate-400">
        Captured live with your camera — no gallery upload. The image is sent to Run Local's server for manual review only.
      </p>
    </div>
  );
}
