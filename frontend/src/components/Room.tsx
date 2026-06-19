import { useEffect, useRef, useState } from "react";
import { getToken } from "../api";
import { useStore } from "../store";
import BoardActions from "./BoardActions";
import { Radio, Mic, PhoneOff, Loader2 } from "lucide-react";

// A push-to-talk voice room. The browser captures + Opus-compresses the mic
// (low bitrate = walkie crunch); the server just relays clips to the room. See
// backend/app/voice.py.
const BITRATE = 16000;

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

  const wsRef = useRef<WebSocket | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const mimeRef = useRef<string>("");
  const txRef = useRef(false);

  function markTalking(who: string, on: boolean) {
    setTalking((prev) => {
      const next = new Set(prev);
      if (on) next.add(who);
      else next.delete(who);
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
          if (m.type === "presence") setParticipants(m.participants || []);
          else if (m.type === "talk") markTalking(m.name, !!m.on);
        } catch {
          /* ignore */
        }
        return;
      }
      const data = e.data as ArrayBuffer;
      const buf = new Uint8Array(data);
      const nameLen = buf[0];
      const sender = new TextDecoder().decode(buf.subarray(1, 1 + nameLen));
      playClip(sender, data.slice(1 + nameLen));
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
        if (blob.size && wsRef.current?.readyState === WebSocket.OPEN) {
          wsRef.current.send(await blob.arrayBuffer());
        }
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

  function cleanup() {
    try {
      if (recRef.current && recRef.current.state !== "inactive") recRef.current.stop();
    } catch {
      /* ignore */
    }
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
    txRef.current = false;
  }

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
              compressed in your browser and relayed to whoever's here.
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
                return (
                  <div
                    key={p}
                    className={`flex flex-col items-center gap-1.5 rounded-xl border px-4 py-3 transition ${
                      isTalking
                        ? "border-[var(--c-accent)] bg-[var(--c-accent-soft)]"
                        : "border-[var(--c-border)]"
                    }`}
                  >
                    <div
                      className={`grid h-12 w-12 place-items-center rounded-full text-lg font-semibold text-white transition ${
                        isTalking ? "ring-2 ring-[var(--c-accent)] ring-offset-2 ring-offset-[var(--c-bg)]" : ""
                      }`}
                      style={{ background: "#64748b" }}
                    >
                      {p.charAt(0).toUpperCase()}
                    </div>
                    <span className="text-xs">
                      {p}
                      {p === user?.name && " (you)"}
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
          </>
        )}
      </div>
    </div>
  );
}
