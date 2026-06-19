import { useEffect, useRef, useState } from "react";
import { Play, Sliders } from "lucide-react";
import type { Attachment } from "../types";
import { formatBytes } from "../format";
import { ditherDuotone } from "../dither";

// A video message with a "compression & aesthetic" menu. CSS-filter looks are
// applied live to the <video>; the canvas looks (dither / pixelate) render the
// playing frames through a small offscreen buffer for the chunky low-fi effect.
type Mode =
  | { id: string; label: string; kind: "css"; filter: string; scan?: boolean }
  | { id: string; label: string; kind: "canvas"; effect: "dither" | "pixelate" };

const MODES: Mode[] = [
  { id: "normal", label: "Normal", kind: "css", filter: "none" },
  { id: "bw", label: "Black & white", kind: "css", filter: "grayscale(1) contrast(1.25)" },
  { id: "sepia", label: "Sepia", kind: "css", filter: "sepia(0.85) contrast(1.1)" },
  { id: "vhs", label: "VHS", kind: "css", filter: "saturate(1.7) contrast(1.2)", scan: true },
  { id: "cold", label: "Cold", kind: "css", filter: "hue-rotate(160deg) saturate(1.3)" },
  { id: "dither", label: "Dither (duotone)", kind: "canvas", effect: "dither" },
  { id: "pixelate", label: "Pixelate (low-res)", kind: "canvas", effect: "pixelate" },
];

const CW = 256;
const CH = 192;

export default function VideoMessage({ a }: { a: Attachment }) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const tmpRef = useRef<HTMLCanvasElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const [mode, setMode] = useState<Mode>(MODES[0]);
  const [menu, setMenu] = useState(false);
  const [playing, setPlaying] = useState(false);

  const canvasMode = mode.kind === "canvas";

  function tmp(w: number, h: number) {
    let t = tmpRef.current;
    if (!t) {
      t = document.createElement("canvas");
      tmpRef.current = t;
    }
    t.width = w;
    t.height = h;
    return t;
  }

  function draw() {
    rafRef.current = requestAnimationFrame(draw);
    const v = videoRef.current;
    const cv = canvasRef.current;
    if (!v || !cv || v.readyState < 2 || mode.kind !== "canvas") return;
    const ctx = cv.getContext("2d");
    if (!ctx) return;
    ctx.imageSmoothingEnabled = false;
    if (mode.effect === "pixelate") {
      const t = tmp(64, 48);
      t.getContext("2d")!.drawImage(v, 0, 0, 64, 48);
      ctx.drawImage(t, 0, 0, 64, 48, 0, 0, CW, CH);
    } else {
      const sw = 112;
      const sh = 84;
      const t = tmp(sw, sh);
      const tctx = t.getContext("2d", { willReadFrequently: true })!;
      tctx.drawImage(v, 0, 0, sw, sh);
      ditherDuotone(tctx, sw, sh);
      ctx.drawImage(t, 0, 0, sw, sh, 0, 0, CW, CH);
    }
  }

  useEffect(() => {
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  function startRaf() {
    if (rafRef.current == null) rafRef.current = requestAnimationFrame(draw);
  }
  function togglePlay() {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) v.play().catch(() => {});
    else v.pause();
  }

  return (
    <div className="max-w-md">
      <div className="relative overflow-hidden rounded-xl border border-[var(--c-border)]">
        <video
          ref={videoRef}
          src={a.url}
          playsInline
          preload="metadata"
          controls={!canvasMode}
          onPlay={() => {
            setPlaying(true);
            startRaf();
          }}
          onPause={() => setPlaying(false)}
          onEnded={() => setPlaying(false)}
          className={canvasMode ? "" : "block max-h-80 w-full"}
          style={
            canvasMode
              ? { position: "absolute", width: 1, height: 1, opacity: 0, pointerEvents: "none" }
              : { filter: mode.kind === "css" ? mode.filter : "none" }
          }
        />
        {canvasMode && (
          <>
            <canvas
              ref={canvasRef}
              width={CW}
              height={CH}
              onClick={togglePlay}
              className="block w-full cursor-pointer bg-[var(--c-bg)]"
              style={{ imageRendering: "pixelated", aspectRatio: `${CW}/${CH}` }}
            />
            {!playing && (
              <button
                onClick={togglePlay}
                className="absolute inset-0 grid place-items-center bg-black/20"
              >
                <span className="grid h-12 w-12 place-items-center rounded-full bg-[var(--c-accent)] text-white shadow-lg">
                  <Play size={20} className="ml-0.5" />
                </span>
              </button>
            )}
          </>
        )}
        {mode.kind === "css" && mode.scan && (
          <div
            className="pointer-events-none absolute inset-0"
            style={{
              background:
                "repeating-linear-gradient(0deg, rgba(0,0,0,0.18) 0, rgba(0,0,0,0.18) 1px, transparent 1px, transparent 3px)",
            }}
          />
        )}
      </div>

      <div className="mt-1 flex items-center gap-2 px-0.5 text-xs text-[var(--c-muted)]">
        <div className="relative">
          <button
            onClick={() => setMenu((v) => !v)}
            className="flex items-center gap-1 rounded-md px-1.5 py-1 hover:bg-[var(--c-elevated)] hover:text-[var(--c-text)]"
            title="Compression & aesthetic"
          >
            <Sliders size={13} /> {mode.label}
          </button>
          {menu && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setMenu(false)} />
              <div className="card absolute bottom-8 left-0 z-20 w-48 overflow-hidden p-1 text-sm shadow-2xl fade-in">
                <div className="px-2 py-1 text-[10px] uppercase tracking-wide text-[var(--c-muted)]">
                  Compression & aesthetic
                </div>
                {MODES.map((m) => (
                  <button
                    key={m.id}
                    onClick={() => {
                      setMode(m);
                      setMenu(false);
                    }}
                    className={`flex w-full items-center justify-between rounded-lg px-2 py-1.5 hover:bg-[var(--c-elevated)] ${
                      mode.id === m.id ? "text-[var(--c-accent)]" : ""
                    }`}
                  >
                    {m.label}
                    {mode.id === m.id && <span>✓</span>}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
        <span className="ml-auto">{formatBytes(a.size)}</span>
      </div>
    </div>
  );
}
