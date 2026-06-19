import { useRef, useState } from "react";
import { api } from "../api";
import type { FileItem } from "../types";
import { Mic, Video, Square, X, Loader2 } from "lucide-react";

// Two composer buttons: record an audio message, or record a low-res, ordered-
// dithered duotone video. Both upload as a normal attachment (audio/webm →
// <audio>, video/webm → <video>) so they live in the chat like any message.

const V_W = 192;
const V_H = 144;
// Duotone palette for the dither (dark → light).
const DARK = [10, 20, 15];
const LIGHT = [134, 214, 168];
// 4×4 Bayer matrix (ordered dithering — fast enough per video frame).
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
      const threshold = ((BAYER[y & 3][x & 3] + 0.5) / 16) * 255;
      const c = lum > threshold ? LIGHT : DARK;
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

function fmt(s: number) {
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export default function MediaCapture({ onAttach }: { onAttach: (f: FileItem) => void }) {
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

  function teardown() {
    stopTimer();
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    try {
      if (recRef.current && recRef.current.state !== "inactive") recRef.current.stop();
    } catch {
      /* ignore */
    }
    recRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setRecording(false);
  }

  function close() {
    teardown();
    setMode(null);
    setSeconds(0);
    setError("");
  }

  async function upload(blob: Blob, kind: "audio" | "video") {
    if (!blob.size) return;
    setBusy(true);
    try {
      const ext = "webm";
      const type = kind === "audio" ? "audio/webm" : "video/webm";
      const file = new File([blob], `${kind}-${Date.now()}.${ext}`, { type });
      const uploaded = await api.upload(file);
      onAttach(uploaded);
    } catch (e: any) {
      setError(e?.message || "Upload failed");
    } finally {
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
      rec.onstop = () => upload(new Blob(chunksRef.current, { type: "audio/webm" }), "audio");
      recRef.current = rec;
      rec.start();
      setMode("audio");
      setRecording(true);
      startTimer();
    } catch (e: any) {
      setError(e?.message || "Couldn't start recording.");
      teardown();
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
      // Wait a tick for the canvas/video elements to mount.
      requestAnimationFrame(() => {
        const v = videoElRef.current!;
        v.srcObject = stream;
        v.play().catch(() => {});
        const cv = canvasRef.current!;
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
      teardown();
    }
  }

  function startVideoRec() {
    const cv = canvasRef.current;
    const stream = streamRef.current;
    if (!cv || !stream) return;
    const canvasStream = cv.captureStream(12);
    const tracks = [...canvasStream.getVideoTracks(), ...stream.getAudioTracks()];
    const combined = new MediaStream(tracks);
    const mime = supported("video/webm;codecs=vp8,opus")
      ? "video/webm;codecs=vp8,opus"
      : supported("video/webm")
      ? "video/webm"
      : "";
    const rec = new MediaRecorder(combined, mime ? { mimeType: mime, videoBitsPerSecond: 300000 } : {});
    chunksRef.current = [];
    rec.ondataavailable = (e) => e.data?.size && chunksRef.current.push(e.data);
    rec.onstop = () => {
      upload(new Blob(chunksRef.current, { type: "video/webm" }), "video");
      close();
    };
    recRef.current = rec;
    rec.start();
    setRecording(true);
    startTimer();
  }

  function stopRec() {
    stopTimer();
    try {
      if (recRef.current && recRef.current.state !== "inactive") recRef.current.stop();
    } catch {
      /* ignore */
    }
    if (mode === "audio") {
      setRecording(false);
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      setMode(null);
    }
    // video closes itself in rec.onstop
  }

  const overlay = mode && (
    <div className="card absolute bottom-full left-0 mb-2 w-full max-w-sm p-3 shadow-2xl fade-in">
      <div className="mb-2 flex items-center gap-2 text-sm">
        {mode === "audio" ? <Mic size={15} className="text-[var(--c-accent)]" /> : <Video size={15} className="text-[var(--c-accent)]" />}
        <span className="font-medium">
          {mode === "audio" ? "Voice message" : "Dithered video"}
        </span>
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
            className="mx-auto block w-full max-w-[16rem] rounded-lg border border-[var(--c-border)]"
            style={{ imageRendering: "pixelated", aspectRatio: `${V_W}/${V_H}` }}
          />
        </>
      )}

      <div className="mt-2 flex items-center justify-center gap-2">
        {mode === "audio" && recording && (
          <button className="btn btn-primary" onClick={stopRec} disabled={busy}>
            {busy ? <Loader2 size={15} className="animate-spin" /> : <Square size={15} />} Stop & send
          </button>
        )}
        {mode === "video" && !recording && (
          <button className="btn btn-primary" onClick={startVideoRec}>
            <Video size={15} /> Record
          </button>
        )}
        {mode === "video" && recording && (
          <button className="btn btn-primary" onClick={stopRec} disabled={busy}>
            {busy ? <Loader2 size={15} className="animate-spin" /> : <Square size={15} />} Stop & send
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
        onClick={() => (mode === "audio" ? close() : startAudio())}
        disabled={mode === "video"}
        title="Record a voice message"
      >
        <Mic size={18} />
      </button>
      <button
        className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-[var(--c-muted)] transition hover:bg-[var(--c-elevated)] hover:text-[var(--c-text)] disabled:opacity-40"
        onClick={() => (mode === "video" ? close() : openVideo())}
        disabled={mode === "audio"}
        title="Record a dithered video"
      >
        <Video size={18} />
      </button>
    </div>
  );
}
