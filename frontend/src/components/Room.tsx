import { useEffect, useRef, useState } from "react";
import { getToken } from "../api";
import { useStore } from "../store";
import { ditherDuotone } from "../dither";
import BoardActions from "./BoardActions";
import { Radio, Mic, PhoneOff, Loader2, Video, VideoOff } from "lucide-react";

// A push-to-talk voice room. The browser captures + Opus-compresses the mic
// (low bitrate = walkie crunch); the server just relays clips to the room. See
// backend/app/voice.py.
//
// Cameras ride the same socket: each binary frame is tagged with a 1-byte kind
// (0 = audio clip, 1 = video frame) before the relay prepends the sender name,
// so receivers can tell them apart. Video is sent as small, low-rate duotone-
// dithered JPEGs to keep the walkie aesthetic (and the bandwidth) tiny.
const BITRATE = 16000;
const KIND_AUDIO = 0;
const KIND_VIDEO = 1;
const VIDEO_W = 192;
const VIDEO_H = 144;
const VIDEO_INTERVAL = 160; // ms between frames (~6 fps)
const VIDEO_QUALITY = 0.6;

function pickMime(): string {
  const cands = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"];
  for (const c of cands) {
    try {
      if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(c)) return c;
    } catch {
      /* ignore */
    }
  }
  return "";
}

export default function Room({
  id,
  name,
  title,
}: {
  id: number;
  name: string;
  title: string;
}) {
  const user = useStore((s) => s.user);
  const [joined, setJoined] = useState(false);
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState("");
  const [participants, setParticipants] = useState<string[]>([]);
  const [talking, setTalking] = useState<Set<string>>(new Set());
  const [transmitting, setTransmitting] = useState(false);
  const [cameraOn, setCameraOn] = useState(false);
  const [dither, setDither] = useState(true);
  // Latest received video frame per sender, as object URLs (remote tiles).
  const [videoFrames, setVideoFrames] = useState<Record<string, string>>({});

  const wsRef = useRef<WebSocket | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const mimeRef = useRef<string>("");
  const txRef = useRef(false);
  // Camera plumbing.
  const camStreamRef = useRef<MediaStream | null>(null);
  const camVideoRef = useRef<HTMLVideoElement | null>(null);
  const localCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const camTimerRef = useRef<number | null>(null);
  const ditherRef = useRef(true);

  function markTalking(who: string, on: boolean) {
    setTalking((prev) => {
      const next = new Set(prev);
      if (on) next.add(who);
      else next.delete(who);
      return next;
    });
  }

  // Prefix a binary frame with its kind byte (audio vs video) before sending.
  function sendFrame(kind: number, bytes: ArrayBuffer) {
    const ws = wsRef.current;
    if (ws?.readyState !== WebSocket.OPEN) return;
    const out = new Uint8Array(1 + bytes.byteLength);
    out[0] = kind;
    out.set(new Uint8Array(bytes), 1);
    ws.send(out.buffer);
  }

  function showVideoFrame(sender: string, jpeg: ArrayBuffer) {
    const url = URL.createObjectURL(new Blob([jpeg], { type: "image/jpeg" }));
    setVideoFrames((prev) => {
      if (prev[sender]) URL.revokeObjectURL(prev[sender]);
      return { ...prev, [sender]: url };
    });
  }

  function dropVideoFrame(sender: string) {
    setVideoFrames((prev) => {
      if (!prev[sender]) return prev;
      URL.revokeObjectURL(prev[sender]);
      const next = { ...prev };
      delete next[sender];
      return next;
    });
  }

  function playClip(sender: string, audio: ArrayBuffer) {
    const blob = new Blob([audio], { type: mimeRef.current || "audio/webm" });
    const url = URL.createObjectURL(blob);
    const a = new Audio(url);
    markTalking(sender, true);
    const done = () => {
      URL.revokeObjectURL(url);
      markTalking(sender, false);
    };
    a.onended = done;
    a.onerror = done;
    a.play().catch(done);
  }

  function connectWs() {
    const proto = location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(
      `${proto}://${location.host}/voice/${name}?token=${encodeURIComponent(getToken() || "")}`
    );
    ws.binaryType = "arraybuffer";
    ws.onmessage = (e) => {
      if (typeof e.data === "string") {
        try {
          const m = JSON.parse(e.data);
          if (m.type === "presence") {
            const list: string[] = m.participants || [];
            setParticipants(list);
            // Drop frames for anyone who left.
            setVideoFrames((prev) => {
              let changed = false;
              const next = { ...prev };
              for (const who of Object.keys(prev))
                if (!list.includes(who)) {
                  URL.revokeObjectURL(prev[who]);
                  delete next[who];
                  changed = true;
                }
              return changed ? next : prev;
            });
          } else if (m.type === "talk") markTalking(m.name, !!m.on);
          else if (m.type === "cam" && !m.on) dropVideoFrame(m.name);
        } catch {
          /* ignore */
        }
        return;
      }
      const data = e.data as ArrayBuffer;
      const buf = new Uint8Array(data);
      const nameLen = buf[0];
      const sender = new TextDecoder().decode(buf.subarray(1, 1 + nameLen));
      const kind = buf[1 + nameLen];
      const payload = data.slice(1 + nameLen + 1);
      if (kind === KIND_VIDEO) showVideoFrame(sender, payload);
      else playClip(sender, payload);
    };
    wsRef.current = ws;
  }

  async function join() {
    if (joining || joined) return;
    setError("");
    setJoining(true);
    try {
      if (typeof MediaRecorder === "undefined" || !navigator.mediaDevices?.getUserMedia) {
        throw new Error("This browser can't capture audio (need a modern browser + HTTPS).");
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
      });
      streamRef.current = stream;
      mimeRef.current = pickMime();
      connectWs();
      setJoined(true);
    } catch (e: any) {
      setError(e?.message || "Couldn't access the microphone.");
      cleanup();
    } finally {
      setJoining(false);
    }
  }

  function startTalk() {
    if (!joined || txRef.current || !streamRef.current) return;
    const ws = wsRef.current;
    try {
      const rec = new MediaRecorder(
        streamRef.current,
        mimeRef.current
          ? { mimeType: mimeRef.current, audioBitsPerSecond: BITRATE }
          : { audioBitsPerSecond: BITRATE }
      );
      chunksRef.current = [];
      rec.ondataavailable = (ev) => {
        if (ev.data && ev.data.size) chunksRef.current.push(ev.data);
      };
      rec.onstop = async () => {
        const blob = new Blob(chunksRef.current, { type: mimeRef.current || "audio/webm" });
        chunksRef.current = [];
        if (blob.size) sendFrame(KIND_AUDIO, await blob.arrayBuffer());
      };
      recRef.current = rec;
      rec.start();
      txRef.current = true;
      setTransmitting(true);
      if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "talk", on: true }));
    } catch {
      /* ignore */
    }
  }

  function stopTalk() {
    if (!txRef.current) return;
    txRef.current = false;
    setTransmitting(false);
    try {
      if (recRef.current && recRef.current.state !== "inactive") recRef.current.stop();
    } catch {
      /* ignore */
    }
    const ws = wsRef.current;
    if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "talk", on: false }));
  }

  // --- Camera --------------------------------------------------------------
  async function startCamera() {
    if (cameraOn) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 320, height: 240, frameRate: 12 },
      });
      camStreamRef.current = stream;
      const v = document.createElement("video");
      v.srcObject = stream;
      v.muted = true;
      v.playsInline = true;
      await v.play();
      camVideoRef.current = v;
      setCameraOn(true);
      camTimerRef.current = window.setInterval(captureFrame, VIDEO_INTERVAL);
    } catch {
      /* permission denied / no camera — silently stay audio-only */
    }
  }

  function captureFrame() {
    const v = camVideoRef.current;
    const canvas = localCanvasRef.current;
    if (!v || !canvas || v.readyState < 2) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
    if (ditherRef.current) ditherDuotone(ctx, canvas.width, canvas.height);
    canvas.toBlob(
      async (blob) => {
        if (blob) sendFrame(KIND_VIDEO, await blob.arrayBuffer());
      },
      "image/jpeg",
      VIDEO_QUALITY
    );
  }

  function stopCamera() {
    if (camTimerRef.current) {
      clearInterval(camTimerRef.current);
      camTimerRef.current = null;
    }
    camStreamRef.current?.getTracks().forEach((t) => t.stop());
    camStreamRef.current = null;
    camVideoRef.current = null;
    setCameraOn(false);
    const ws = wsRef.current;
    if (ws?.readyState === WebSocket.OPEN)
      ws.send(JSON.stringify({ type: "cam", on: false }));
  }

  function cleanup() {
    try {
      if (recRef.current && recRef.current.state !== "inactive") recRef.current.stop();
    } catch {
      /* ignore */
    }
    if (camTimerRef.current) {
      clearInterval(camTimerRef.current);
      camTimerRef.current = null;
    }
    camStreamRef.current?.getTracks().forEach((t) => t.stop());
    camStreamRef.current = null;
    camVideoRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    wsRef.current?.close();
    wsRef.current = null;
  }

  function leave() {
    cleanup();
    setJoined(false);
    setParticipants([]);
    setTalking(new Set());
    setTransmitting(false);
    setCameraOn(false);
    setVideoFrames((prev) => {
      Object.values(prev).forEach((u) => URL.revokeObjectURL(u));
      return {};
    });
    txRef.current = false;
  }

  // Keep the capture loop's dither flag in sync without re-creating the timer.
  useEffect(() => {
    ditherRef.current = dither;
  }, [dither]);

  // Spacebar = push-to-talk.
  useEffect(() => {
    if (!joined) return;
    const onDown = (e: KeyboardEvent) => {
      if (e.code !== "Space" || e.repeat) return;
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      e.preventDefault();
      startTalk();
    };
    const onUp = (e: KeyboardEvent) => {
      if (e.code !== "Space") return;
      e.preventDefault();
      stopTalk();
    };
    window.addEventListener("keydown", onDown);
    window.addEventListener("keyup", onUp);
    return () => {
      window.removeEventListener("keydown", onDown);
      window.removeEventListener("keyup", onUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [joined]);

  // Tear down on unmount / when switching boards.
  useEffect(() => () => cleanup(), []);

  return (
    <div className="flex h-full flex-col">
      <header className="surface flex items-center gap-3 border-b border-[var(--c-border)] px-4 py-3 pl-14 md:pl-4">
        <Radio size={18} className="text-[var(--c-muted)]" />
        <div className="font-semibold">{title}</div>
        <BoardActions id={id} name={title} />
        {joined && (
          <button className="btn ml-auto !py-1.5 text-xs text-red-300" onClick={leave}>
            <PhoneOff size={14} /> Leave
          </button>
        )}
      </header>

      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-6 p-6">
        {!joined ? (
          <div className="flex flex-col items-center gap-3 text-center">
            <Radio size={40} className="text-[var(--c-accent)]" />
            <h2 className="font-display text-xl font-semibold">{title}</h2>
            <p className="max-w-sm text-sm text-[var(--c-muted)]">
              A walkie-talkie room — hold to talk, release to send. Audio is
              compressed in your browser and relayed to whoever's here. You can
              also switch on your camera for a low-fi dithered video feed.
            </p>
            <button className="btn btn-primary" onClick={join} disabled={joining}>
              {joining ? <Loader2 size={16} className="animate-spin" /> : <Mic size={16} />}
              {joining ? "Joining…" : "Join room"}
            </button>
            {error && <p className="text-sm text-red-300">{error}</p>}
          </div>
        ) : (
          <>
            {/* Participants */}
            <div className="flex flex-wrap items-center justify-center gap-3">
              {participants.length === 0 && (
                <span className="text-sm text-[var(--c-muted)]">Just you so far…</span>
              )}
              {participants.map((p) => {
                const isTalking = talking.has(p) || (p === user?.name && transmitting);
                const isMe = p === user?.name;
                const hasLocalCam = isMe && cameraOn;
                const remoteFrame = !isMe ? videoFrames[p] : undefined;
                const hasVideo = hasLocalCam || !!remoteFrame;
                return (
                  <div
                    key={p}
                    className={`flex flex-col items-center gap-1.5 rounded-xl border px-4 py-3 transition ${
                      isTalking
                        ? "border-[var(--c-accent)] bg-[var(--c-accent-soft)]"
                        : "border-[var(--c-border)]"
                    }`}
                  >
                    {hasVideo ? (
                      <div
                        className={`overflow-hidden rounded-lg transition ${
                          isTalking ? "ring-2 ring-[var(--c-accent)]" : ""
                        }`}
                      >
                        {hasLocalCam ? (
                          <canvas
                            ref={localCanvasRef}
                            width={VIDEO_W}
                            height={VIDEO_H}
                            className="h-24 w-32 -scale-x-100 object-cover"
                          />
                        ) : (
                          <img src={remoteFrame} alt="" className="h-24 w-32 object-cover" />
                        )}
                      </div>
                    ) : (
                      <div
                        className={`grid h-12 w-12 place-items-center rounded-full text-lg font-semibold text-white transition ${
                          isTalking ? "ring-2 ring-[var(--c-accent)] ring-offset-2 ring-offset-[var(--c-bg)]" : ""
                        }`}
                        style={{ background: "#64748b" }}
                      >
                        {p.charAt(0).toUpperCase()}
                      </div>
                    )}
                    <span className="text-xs">
                      {p}
                      {isMe && " (you)"}
                    </span>
                    <span className="h-3 text-[10px] text-[var(--c-accent)]">
                      {isTalking ? "🔊 talking" : ""}
                    </span>
                  </div>
                );
              })}
            </div>

            {/* Push to talk */}
            <button
              className={`grid h-36 w-36 select-none place-items-center rounded-full text-sm font-semibold transition ${
                transmitting
                  ? "scale-105 bg-[var(--c-accent)] text-white shadow-xl"
                  : "bg-[var(--c-elevated)] text-[var(--c-text)] hover:bg-[var(--c-surface-2)]"
              }`}
              onMouseDown={startTalk}
              onMouseUp={stopTalk}
              onMouseLeave={stopTalk}
              onTouchStart={(e) => {
                e.preventDefault();
                startTalk();
              }}
              onTouchEnd={(e) => {
                e.preventDefault();
                stopTalk();
              }}
              onContextMenu={(e) => e.preventDefault()}
            >
              <div className="flex flex-col items-center gap-1">
                <Mic size={32} />
                {transmitting ? "On air" : "Hold to talk"}
              </div>
            </button>
            <p className="text-xs text-[var(--c-muted)]">Hold the button or the spacebar.</p>

            {/* Camera controls */}
            <div className="flex items-center gap-2">
              <button
                className={`btn ${cameraOn ? "btn-primary" : ""}`}
                onClick={() => (cameraOn ? stopCamera() : startCamera())}
              >
                {cameraOn ? <VideoOff size={16} /> : <Video size={16} />}
                {cameraOn ? "Stop camera" : "Start camera"}
              </button>
              {cameraOn && (
                <label className="flex cursor-pointer items-center gap-1.5 text-xs text-[var(--c-muted)]">
                  <input
                    type="checkbox"
                    checked={dither}
                    onChange={(e) => setDither(e.target.checked)}
                  />
                  Dither
                </label>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
