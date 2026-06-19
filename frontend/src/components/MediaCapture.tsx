import { useRef, useState } from "react";
import { api } from "../api";
import type { FileItem } from "../types";
import { Mic, Video, X, Loader2, Send, Circle } from "lucide-react";

// Two composer buttons: record an audio message, or record a low-res, ordered-
// dithered duotone video. Both upload and POST immediately as a chat message
// (audio/webm → <audio>, video/webm → <video>) via the onSend callback.

const V_W = 192;
const V_H = 144;
const DARK = [10, 20, 15];
const LIGHT = [134, 214, 168];
const BAYER = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
];

function ditherDuotone(ctx: CanvasRenderingContext2D, w: number, h: number) {
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const lum = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
      const t = ((BAYER[y & 3][x & 3] + 0.5) / 16) * 255;
      const c = lum > t ? LIGHT : DARK;
      d[i] = c[0];
      d[i + 1] = c[1];
      d[i + 2] = c[2];
      d[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
}

function supported(mime: string): boolean {
  try {
    return typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(mime);
  } catch {
    return false;
  }
}
const fmt = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

export default function MediaCapture({
  onSend,
}: {
  onSend: (f: FileItem) => Promise<void>;
}) {
  const [mode, setMode] = useState<null | "audio" | "video">(null);
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const streamRef = useRef<MediaStream | null>(null);
  const recRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<number | null>(null);
  const rafRef = useRef<number | null>(null);
  const videoElRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  function startTimer() {
    setSeconds(0);
    timerRef.current = window.setInterval(() => setSeconds((s) => s + 1), 1000);
  }
  function stopTimer() {
    if (timerRef.current) window.clearInterval(timerRef.current);
    timerRef.current = null;
  }
  function stopMedia() {
    stopTimer();
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setRecording(false);
  }
  function close() {
    try {
      if (recRef.current && recRef.current.state !== "inactive") recRef.current.stop();
    } catch {
      /* ignore */
    }
    recRef.current = null;
    stopMedia();
    setMode(null);
    setSeconds(0);
    setError("");
    setBusy(false);
  }

  async function uploadAndSend(blob: Blob, kind: "audio" | "video") {
    stopMedia();
    if (!blob.size) {
      close();
      return;
    }
    setBusy(true);
    setError("");
    try {
      const type = kind === "audio" ? "audio/webm" : "video/webm";
      const file = new File([blob], `${kind}-${Date.now()}.webm`, { type });
      const uploaded = await api.upload(file);
      await onSend(uploaded);
      close();
    } catch (e: any) {
      setError(e?.message || "Couldn't send — try again.");
      setBusy(false);
    }
  }

  // ---- audio --------------------------------------------------------------
  async function startAudio() {
    setError("");
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error("No mic access in this browser.");
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
      });
      streamRef.current = stream;
      const mime = supported("audio/webm;codecs=opus") ? "audio/webm;codecs=opus" : "";
      const rec = new MediaRecorder(stream, mime ? { mimeType: mime, audioBitsPerSecond: 24000 } : {});
      chunksRef.current = [];
      rec.ondataavailable = (e) => e.data?.size && chunksRef.current.push(e.data);
      rec.onstop = () => uploadAndSend(new Blob(chunksRef.current, { type: "audio/webm" }), "audio");
      recRef.current = rec;
      rec.start();
      setMode("audio");
      setRecording(true);
      startTimer();
    } catch (e: any) {
      setError(e?.message || "Couldn't start recording.");
      stopMedia();
    }
  }

  // ---- video (dithered) ---------------------------------------------------
  async function openVideo() {
    setError("");
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error("No camera access in this browser.");
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 320, height: 240 },
        audio: true,
      });
      streamRef.current = stream;
      setMode("video");
      requestAnimationFrame(() => {
        const v = videoElRef.current;
        const cv = canvasRef.current;
        if (!v || !cv) return;
        v.srcObject = stream;
        v.play().catch(() => {});
        const ctx = cv.getContext("2d", { willReadFrequently: true })!;
        const loop = () => {
          if (v.readyState >= 2) {
            ctx.drawImage(v, 0, 0, V_W, V_H);
            ditherDuotone(ctx, V_W, V_H);
          }
          rafRef.current = requestAnimationFrame(loop);
        };
        loop();
      });
    } catch (e: any) {
      setError(e?.message || "Couldn't open the camera.");
      stopMedia();
      setMode(null);
    }
  }

  function startVideoRec() {
    const cv = canvasRef.current;
    const stream = streamRef.current;
    if (!cv || !stream) return;
    const combined = new MediaStream([
      ...cv.captureStream(12).getVideoTracks(),
      ...stream.getAudioTracks(),
    ]);
    const mime = supported("video/webm;codecs=vp8,opus")
      ? "video/webm;codecs=vp8,opus"
      : supported("video/webm")
      ? "video/webm"
      : "";
    const rec = new MediaRecorder(combined, mime ? { mimeType: mime, videoBitsPerSecond: 300000 } : {});
    chunksRef.current = [];
    rec.ondataavailable = (e) => e.data?.size && chunksRef.current.push(e.data);
    rec.onstop = () => uploadAndSend(new Blob(chunksRef.current, { type: "video/webm" }), "video");
    recRef.current = rec;
    rec.start();
    setRecording(true);
    startTimer();
  }

  // Stop the recorder → its onstop uploads + sends.
  function finish() {
    setBusy(true);
    try {
      if (recRef.current && recRef.current.state !== "inactive") recRef.current.stop();
      else close();
    } catch {
      close();
    }
  }

  const overlay = mode && (
    <div className="card absolute bottom-full left-1/2 z-20 mb-2 w-72 max-w-[80vw] -translate-x-1/2 p-3 shadow-2xl fade-in">
      <div className="mb-2 flex items-center gap-2 text-sm">
        {mode === "audio" ? (
          <Mic size={15} className="text-[var(--c-accent)]" />
        ) : (
          <Video size={15} className="text-[var(--c-accent)]" />
        )}
        <span className="font-medium">{mode === "audio" ? "Voice message" : "Dithered video"}</span>
        {recording && (
          <span className="flex items-center gap-1.5 text-xs text-red-300">
            <span className="h-2 w-2 animate-pulse rounded-full bg-red-400" /> {fmt(seconds)}
          </span>
        )}
        <button className="ml-auto text-[var(--c-muted)] hover:text-[var(--c-text)]" onClick={close} title="Cancel">
          <X size={16} />
        </button>
      </div>

      {mode === "video" && (
        <>
          <video ref={videoElRef} className="hidden" muted playsInline />
          <canvas
            ref={canvasRef}
            width={V_W}
            height={V_H}
            className="mx-auto mb-2 block w-full rounded-lg border border-[var(--c-border)]"
            style={{ imageRendering: "pixelated", aspectRatio: `${V_W}/${V_H}` }}
          />
        </>
      )}

      <div className="flex items-center justify-end gap-2">
        <button className="btn !py-1.5 text-xs" onClick={close} disabled={busy}>
          Cancel
        </button>
        {mode === "video" && !recording ? (
          <button className="btn btn-primary !py-1.5 text-xs" onClick={startVideoRec}>
            <Circle size={13} className="fill-current" /> Record
          </button>
        ) : (
          <button className="btn btn-primary !py-1.5 text-xs" onClick={finish} disabled={busy}>
            {busy ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
            {busy ? "Sending…" : "Send"}
          </button>
        )}
      </div>
      {error && <p className="mt-2 text-center text-xs text-red-300">{error}</p>}
    </div>
  );

  return (
    <div className="relative flex">
      {overlay}
      <button
        className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-[var(--c-muted)] transition hover:bg-[var(--c-elevated)] hover:text-[var(--c-text)] disabled:opacity-40"
        onClick={() => (mode ? close() : startAudio())}
        disabled={mode === "video"}
        title="Record a voice message"
      >
        <Mic size={18} />
      </button>
      <button
        className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-[var(--c-muted)] transition hover:bg-[var(--c-elevated)] hover:text-[var(--c-text)] disabled:opacity-40"
        onClick={() => (mode ? close() : openVideo())}
        disabled={mode === "audio"}
        title="Record a dithered video"
      >
        <Video size={18} />
      </button>
    </div>
  );
}
