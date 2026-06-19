import { useEffect, useRef, useState } from "react";
import { Play, Pause, MoreVertical } from "lucide-react";
import type { Attachment } from "../types";
import { formatBytes } from "../format";

// A voice-message player: play/pause, a click-to-seek progress line, a live
// spectrogram that scrolls right→left while playing, and a "Processing" menu of
// Web Audio playback effects.
type Preset = {
  id: string;
  label: string;
  rate: number;
  type: BiquadFilterType;
  freq: number;
  q: number;
};
const PRESETS: Preset[] = [
  { id: "normal", label: "Normal", rate: 1, type: "allpass", freq: 1000, q: 1 },
  { id: "phone", label: "Walkie / phone", rate: 1, type: "bandpass", freq: 1600, q: 0.7 },
  { id: "deep", label: "Deep & slow", rate: 0.82, type: "lowpass", freq: 1100, q: 1 },
  { id: "chipmunk", label: "Chipmunk", rate: 1.6, type: "highpass", freq: 200, q: 1 },
  { id: "bright", label: "Bright", rate: 1, type: "highshelf", freq: 2500, q: 1 },
];

const W = 280;
const H = 56;

function fmt(t: number) {
  if (!isFinite(t) || t < 0) t = 0;
  return `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}`;
}

export default function AudioMessage({ a }: { a: Attachment }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const acRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const filterRef = useRef<BiquadFilterNode | null>(null);
  const rafRef = useRef<number | null>(null);

  const [playing, setPlaying] = useState(false);
  const [cur, setCur] = useState(0);
  const [dur, setDur] = useState(0);
  const [menu, setMenu] = useState(false);
  const [preset, setPreset] = useState<Preset>(PRESETS[0]);

  function applyPreset(p: Preset) {
    setPreset(p);
    const f = filterRef.current;
    if (f) {
      f.type = p.type;
      f.frequency.value = p.freq;
      f.Q.value = p.q;
    }
    if (audioRef.current) audioRef.current.playbackRate = p.rate;
  }

  // Build the Web Audio graph lazily (must follow a user gesture). Once a media
  // element is routed through Web Audio, its output goes via the graph.
  function ensureGraph() {
    if (acRef.current || !audioRef.current) return;
    try {
      const AC = window.AudioContext || (window as any).webkitAudioContext;
      if (!AC) return;
      const ac: AudioContext = new AC();
      const src = ac.createMediaElementSource(audioRef.current);
      const filter = ac.createBiquadFilter();
      const analyser = ac.createAnalyser();
      analyser.fftSize = 128;
      analyser.smoothingTimeConstant = 0.7;
      src.connect(filter);
      filter.connect(analyser);
      analyser.connect(ac.destination);
      acRef.current = ac;
      filterRef.current = filter;
      analyserRef.current = analyser;
      applyPreset(preset);
    } catch {
      /* Web Audio unavailable — playback still works, just no spectrogram. */
    }
  }

  async function toggle() {
    const au = audioRef.current;
    if (!au) return;
    ensureGraph();
    if (acRef.current?.state === "suspended") await acRef.current.resume();
    if (au.paused) await au.play().catch(() => {});
    else au.pause();
  }

  function drawColumn() {
    rafRef.current = requestAnimationFrame(drawColumn);
    const analyser = analyserRef.current;
    const cv = canvasRef.current;
    const ctx = cv?.getContext("2d");
    if (!analyser || !cv || !ctx) return;
    const bins = analyser.frequencyBinCount;
    const data = new Uint8Array(bins);
    analyser.getByteFrequencyData(data);
    // Scroll existing content left by 2px, then paint the newest column at the right.
    ctx.globalCompositeOperation = "copy";
    ctx.drawImage(cv, -2, 0);
    ctx.globalCompositeOperation = "source-over";
    ctx.clearRect(W - 2, 0, 2, H);
    for (let y = 0; y < H; y++) {
      const bin = Math.floor((1 - y / H) * (bins - 1)); // low freq at the bottom
      const v = data[bin] / 255;
      if (v <= 0.03) continue;
      const r = Math.round(60 + v * 90);
      const g = Math.round(150 + v * 90);
      const b = Math.round(110 + v * 70);
      ctx.fillStyle = `rgba(${r},${g},${b},${0.2 + 0.8 * v})`;
      ctx.fillRect(W - 2, y, 2, 1);
    }
  }

  useEffect(() => {
    const au = audioRef.current;
    if (!au) return;
    const startRaf = () => {
      if (rafRef.current == null) rafRef.current = requestAnimationFrame(drawColumn);
    };
    const stopRaf = () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    };
    const onPlay = () => {
      setPlaying(true);
      startRaf();
    };
    const onPause = () => {
      setPlaying(false);
      stopRaf();
    };
    const onTime = () => setCur(au.currentTime);
    const onMeta = () => {
      if (au.duration === Infinity || isNaN(au.duration)) {
        // MediaRecorder webm clips report Infinity until seeked — nudge it.
        au.currentTime = 1e101;
        const fix = () => {
          au.removeEventListener("timeupdate", fix);
          setDur(au.duration);
          au.currentTime = 0;
        };
        au.addEventListener("timeupdate", fix);
      } else setDur(au.duration);
    };
    au.addEventListener("play", onPlay);
    au.addEventListener("pause", onPause);
    au.addEventListener("ended", onPause);
    au.addEventListener("timeupdate", onTime);
    au.addEventListener("loadedmetadata", onMeta);
    return () => {
      au.removeEventListener("play", onPlay);
      au.removeEventListener("pause", onPause);
      au.removeEventListener("ended", onPause);
      au.removeEventListener("timeupdate", onTime);
      au.removeEventListener("loadedmetadata", onMeta);
      stopRaf();
      acRef.current?.close().catch(() => {});
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function seek(e: React.MouseEvent) {
    const au = audioRef.current;
    if (!au || !isFinite(dur) || dur <= 0) return;
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    au.currentTime = ((e.clientX - rect.left) / rect.width) * dur;
  }

  const pct = dur > 0 ? Math.min(100, (cur / dur) * 100) : 0;

  return (
    <div className="card max-w-md p-2">
      <audio ref={audioRef} src={a.url} preload="metadata" className="hidden" />
      <div className="flex items-center gap-2.5">
        <button
          onClick={toggle}
          className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[var(--c-accent)] text-white transition hover:brightness-110"
          title={playing ? "Pause" : "Play"}
        >
          {playing ? <Pause size={16} /> : <Play size={16} className="ml-0.5" />}
        </button>
        <div className="min-w-0 flex-1">
          <canvas
            ref={canvasRef}
            width={W}
            height={H}
            onClick={seek}
            className="block h-10 w-full cursor-pointer rounded-md bg-[var(--c-bg)]"
          />
          <div className="mt-1 h-0.5 w-full overflow-hidden rounded bg-[var(--c-elevated)]">
            <div className="h-full rounded bg-[var(--c-accent)]" style={{ width: `${pct}%` }} />
          </div>
        </div>
        <span className="shrink-0 text-xs tabular-nums text-[var(--c-muted)]">
          {fmt(cur)}
          {dur ? ` / ${fmt(dur)}` : ""}
          <span className="ml-1 opacity-70">· {formatBytes(a.size)}</span>
        </span>
        <div className="relative shrink-0">
          <button
            onClick={() => setMenu((v) => !v)}
            className="grid h-7 w-7 place-items-center rounded-lg text-[var(--c-muted)] hover:bg-[var(--c-elevated)] hover:text-[var(--c-text)]"
            title="Processing"
          >
            <MoreVertical size={16} />
          </button>
          {menu && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setMenu(false)} />
              <div className="card absolute right-0 top-8 z-20 w-44 overflow-hidden p-1 text-sm shadow-2xl fade-in">
                <div className="px-2 py-1 text-[10px] uppercase tracking-wide text-[var(--c-muted)]">
                  Processing
                </div>
                {PRESETS.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => {
                      ensureGraph();
                      applyPreset(p);
                      setMenu(false);
                    }}
                    className={`flex w-full items-center justify-between rounded-lg px-2 py-1.5 hover:bg-[var(--c-elevated)] ${
                      preset.id === p.id ? "text-[var(--c-accent)]" : ""
                    }`}
                  >
                    {p.label}
                    {preset.id === p.id && <span>✓</span>}
                  </button>
                ))}
                <div className="my-1 border-t border-[var(--c-border)]" />
                <a
                  href={`${a.url}?download=true`}
                  className="block rounded-lg px-2 py-1.5 hover:bg-[var(--c-elevated)]"
                >
                  Download
                </a>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
