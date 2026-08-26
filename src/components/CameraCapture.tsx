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
  /** "user" (front/selfie) or "environment" (rear) — default "user" preserves the original selfie-verification behavior exactly. */
  facingMode?: "user" | "environment";
  /** Mirror the preview and capture, matching what a front camera shows you. Defaults to true for "user" facing, should be false for "environment" (a rear photo should never be mirrored). */
  mirror?: boolean;
}

function downscaleToDataUrl(video: HTMLVideoElement, mirror: boolean): string {
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
  // user saw; the preview video element is mirrored with CSS too. Only
  // applies to front-facing capture — a rear-camera photo should never be
  // mirrored, that would flip any text or scene backwards.
  if (mirror) { ctx.translate(w, 0); ctx.scale(-1, 1); }
  ctx.drawImage(video, 0, 0, w, h);
  return canvas.toDataURL("image/jpeg", SELFIE_JPEG_QUALITY);
}

export function CameraCapture({ onCapture, onCancel, confirmLabel = "Use photo", facingMode = "user", mirror: mirrorProp = facingMode === "user" }: CameraCaptureProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [status, setStatus] = useState<CameraStatus>("requesting");
  const [errorDetail, setErrorDetail] = useState<string>("");
  const [capturedUrl, setCapturedUrl] = useState<string | null>(null);
  // Desktop webcam mirroring is genuinely inconsistent across hardware/drivers
  // — some already present a mirrored feed, some don't — so there's no
  // reliable way to auto-detect the "correct" direction. Let the user flip it
  // themselves, the same mitigation every video app (Zoom, Meet, FaceTime)
  // uses for this exact problem. Only offered for front-facing capture.
  const [flipped, setFlipped] = useState(false);
  const mirror = facingMode === "user" ? mirrorProp !== flipped : mirrorProp;

  const stopTracks = useCallback(() => {
    if (streamRef.current) {
      for (const track of streamRef.current.getTracks()) track.stop();
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  }, []);

  const attachStream = useCallback((stream: MediaStream) => {
    const video = videoRef.current;
    if (!video) return;
    video.srcObject = stream;
    void video.play().catch(() => {});
  }, []);

  const handleLoadedData = useCallback(() => {
    setStatus((prev) => (prev === "requesting" ? "ready" : prev));
  }, []);

  const startCamera = useCallback(async () => {
    stopTracks();
    setStatus("requesting");
    setErrorDetail("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode, width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
      streamRef.current = stream;
      if (!videoRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
        return;
      }
      attachStream(stream);
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
  }, [attachStream, stopTracks]);

  useEffect(() => {
    if (streamRef.current) attachStream(streamRef.current);
  }, [status, attachStream]);

  useEffect(() => {
    void startCamera();
    return stopTracks; // stop tracks on unmount / exit — always
  }, [startCamera, stopTracks]);

  const capture = useCallback(() => {
    const video = videoRef.current;
    if (!video || video.videoWidth === 0 || video.readyState < 2) {
      setErrorDetail("The camera preview is not ready yet. Please wait a moment and try again.");
      return;
    }
    try {
      const dataUrl = downscaleToDataUrl(video, mirror);
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
        <video
          ref={videoRef}
          playsInline
          muted
          autoPlay
          className={`h-full w-full object-cover ${status === "ready" ? "" : "invisible"}`}
          style={mirror ? { transform: "scaleX(-1)" } : undefined}
          aria-label="Live selfie preview"
          onLoadedData={handleLoadedData}
        />
        {status === "ready" && facingMode === "user" && (
          <button
            type="button"
            onClick={() => setFlipped((f) => !f)}
            aria-label="Flip preview if it looks mirrored the wrong way"
            className="absolute right-3 top-3 flex items-center gap-1.5 rounded-full bg-black/50 px-3 py-2 text-xs font-semibold text-white backdrop-blur-sm active:bg-black/70"
          >
            <Icon name="refresh" className="h-3.5 w-3.5" /> Flip
          </button>
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
            className="grid h-16 w-16 place-items-center rounded-[10px] bg-[#14171C] ring-4 ring-[#14171C]/20 active:scale-95"
          >
            <span className="h-11 w-11 rounded-full border-4 border-[#FF5741]" />
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
        Captured live with your camera — no gallery upload. The image is sent to Kimbio's server for manual review only.
      </p>
    </div>
  );
}
