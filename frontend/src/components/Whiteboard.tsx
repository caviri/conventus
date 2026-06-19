import { useEffect, useMemo, useRef, useState } from "react";
import * as Y from "yjs";
import { useStore } from "../store";
import { api } from "../api";
import { createCollab } from "../collab";
import BoardActions from "./BoardActions";
import {
  Pencil,
  Trash2,
  Eraser,
  ImagePlus,
  MousePointer2,
  MessageCircle,
  Hand,
  ZoomIn,
  ZoomOut,
  RotateCcw,
  RotateCw,
  Maximize2,
  Minimize2,
  ArrowUpToLine,
  Maximize,
  Map as MapIcon,
  X,
} from "lucide-react";

// Fixed internal resolution; a view transform (scale + pan) sits on top so the
// board can be zoomed and panned without changing the stored coordinates.
const W = 1600;
const H = 1000;
const MIN_SCALE = 0.2;
const MAX_SCALE = 6;

type Tool = "select" | "pen" | "eraser" | "image" | "comment" | "pan";

function uid() {
  return (
    (typeof crypto !== "undefined" && crypto.randomUUID && crypto.randomUUID()) ||
    Date.now().toString(36) + Math.random().toString(36).slice(2)
  );
}

interface Stroke {
  points: [number, number][];
  color: string;
  width: number;
}

const COLORS = ["#0f172a", "#ef4444", "#f59e0b", "#10b981", "#3b82f6", "#8b5cf6", "#ffffff"];

// Distance from point p to segment a-b (for the eraser hit-test).
function segDist(px: number, py: number, ax: number, ay: number, bx: number, by: number) {
  const dx = bx - ax,
    dy = by - ay;
  const len2 = dx * dx + dy * dy || 1;
  let t = ((px - ax) * dx + (py - ay) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  const cx = ax + t * dx,
    cy = ay + t * dy;
  return Math.hypot(px - cx, py - cy);
}

export default function Whiteboard({
  id,
  name,
  title,
}: {
  id: number;
  name: string;
  title: string;
}) {
  const user = useStore((s) => s.user);
  const members = useStore((s) => s.members);
  const collab = useMemo(() => createCollab(name), [name]);
  const strokes = useMemo(() => collab.doc.getArray<Stroke>("strokes"), [collab]);
  const images = useMemo(() => collab.doc.getArray<Y.Map<any>>("images"), [collab]);
  const comments = useMemo(() => collab.doc.getArray<Y.Map<any>>("comments"), [collab]);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const miniRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef<Stroke | null>(null);
  const dragImg = useRef<{ m: Y.Map<any>; ox: number; oy: number; startX: number; startY: number } | null>(null);
  const panning = useRef<{ lx: number; ly: number } | null>(null);
  const miniDrag = useRef(false);
  const imgCache = useRef<Map<string, HTMLImageElement>>(new Map());
  const imageFile = useRef<HTMLInputElement>(null);
  // View transform maps world coords (the fixed W×H board) → CSS pixels in the
  // canvas, which now fills its whole container instead of a fixed-ratio box.
  const view = useRef({ scale: 1, x: 0, y: 0 });
  // While false, the board auto-fits the panel on every resize; the first
  // pan/zoom flips it true so we stop fighting the user's chosen view.
  const userAdjusted = useRef(false);
  const selectedRef = useRef<string | null>(null);
  // Displayed canvas size in CSS pixels; tracked so overlays re-render on resize.
  const [size, setSize] = useState({ w: W, h: H });
  const [showMini, setShowMini] = useState(true);

  const [tool, setTool] = useState<Tool>("pen");
  const [color, setColor] = useState(user?.color || "#3b82f6");
  const [width, setWidth] = useState(4);
  const [selected, setSelected] = useState<string | null>(null);
  const [editComment, setEditComment] = useState<string | null>(null);
  const [, bump] = useState(0);
  const rerender = () => bump((t) => t + 1);
  const [peers, setPeers] = useState<{ name: string; color: string }[]>([]);
  const [cursors, setCursors] = useState<
    { id: number; name: string; color: string; x: number; y: number }[]
  >([]);
  const lastCursor = useRef(0);

  const toolRef = useRef(tool);
  toolRef.current = tool;

  function selectImage(idv: string | null) {
    selectedRef.current = idv;
    setSelected(idv);
  }

  // ---- coordinate helpers ------------------------------------------------
  // CSS pixels relative to the canvas's top-left.
  function toCanvasPx(e: { clientX: number; clientY: number }) {
    const rect = canvasRef.current!.getBoundingClientRect();
    return [e.clientX - rect.left, e.clientY - rect.top] as [number, number];
  }
  function toWorld(e: { clientX: number; clientY: number }) {
    const [cx, cy] = toCanvasPx(e);
    const v = view.current;
    return [(cx - v.x) / v.scale, (cy - v.y) / v.scale] as [number, number];
  }
  // World point → CSS pixel offset in the canvas box, for positioning overlays.
  function project(wx: number, wy: number) {
    const v = view.current;
    return { left: wx * v.scale + v.x, top: wy * v.scale + v.y };
  }

  function imgById(idv: string): { m: Y.Map<any>; i: number } | null {
    for (let i = 0; i < images.length; i++) {
      if (images.get(i).get("id") === idv) return { m: images.get(i), i };
    }
    return null;
  }

  function publishCursor(x: number, y: number) {
    const now = Date.now();
    if (now - lastCursor.current < 40) return;
    lastCursor.current = now;
    collab.awareness.setLocalStateField("cursor", { x, y });
  }

  // ---- drawing -----------------------------------------------------------
  function draw(stroke: Stroke, ctx: CanvasRenderingContext2D) {
    if (stroke.points.length < 1) return;
    ctx.strokeStyle = stroke.color;
    ctx.lineWidth = stroke.width;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    stroke.points.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
    ctx.stroke();
  }

  function drawImage(im: Y.Map<any>, ctx: CanvasRenderingContext2D, mini = false) {
    const url = im.get("url") as string;
    let cached = imgCache.current.get(url);
    if (!cached) {
      cached = new Image();
      cached.onload = () => redraw();
      cached.src = url;
      imgCache.current.set(url, cached);
    }
    if (!cached.complete || !cached.naturalWidth) return;
    const x = im.get("x") as number;
    const y = im.get("y") as number;
    const w = im.get("w") as number;
    const h = im.get("h") as number;
    const rot = (im.get("rot") as number) || 0;
    const cx = x + w / 2,
      cy = y + h / 2;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(rot);
    ctx.drawImage(cached, -w / 2, -h / 2, w, h);
    if (!mini && selectedRef.current === im.get("id")) {
      ctx.strokeStyle = "#3b82f6";
      ctx.lineWidth = 2 / view.current.scale;
      ctx.setLineDash([6 / view.current.scale, 4 / view.current.scale]);
      ctx.strokeRect(-w / 2, -h / 2, w, h);
      ctx.setLineDash([]);
    }
    ctx.restore();
  }

  function redraw() {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const dpr = window.devicePixelRatio || 1;
    const v = view.current;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    // Full-bleed white: the whole panel is the drawing surface (no dark margins).
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(dpr * v.scale, 0, 0, dpr * v.scale, dpr * v.x, dpr * v.y);
    // A faint outline of the "page" bounds for orientation (matches the minimap).
    ctx.strokeStyle = "rgba(100,116,139,0.25)";
    ctx.lineWidth = 1 / v.scale;
    ctx.strokeRect(0, 0, W, H);
    images.forEach((im) => drawImage(im, ctx));
    strokes.forEach((s) => draw(s, ctx));
    if (drawing.current) draw(drawing.current, ctx);
    drawMinimap();
  }

  function drawMinimap() {
    const mc = miniRef.current;
    const ctx = mc?.getContext("2d");
    if (!mc || !ctx) return;
    // Backing store is a fixed 160×100 (see JSX) — scale the world into it.
    const s = Math.min(mc.width / W, mc.height / H);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, mc.width, mc.height);
    // World content, scaled to fit the minimap.
    ctx.setTransform(s, 0, 0, s, 0, 0);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, W, H);
    images.forEach((im) => drawImage(im, ctx, true));
    strokes.forEach((st) => draw(st, ctx));
    // Current viewport rectangle (the slice of the world on screen).
    const main = canvasRef.current;
    const v = view.current;
    const vx = -v.x / v.scale;
    const vy = -v.y / v.scale;
    const vw = (main?.clientWidth || size.w) / v.scale;
    const vh = (main?.clientHeight || size.h) / v.scale;
    ctx.lineWidth = 2 / s;
    ctx.strokeStyle = "#3b82f6";
    ctx.strokeRect(vx, vy, vw, vh);
  }

  async function addImage(file: File | undefined) {
    if (!file || !file.type.startsWith("image/")) return;
    const up = await api.upload(file);
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, 560 / img.naturalWidth);
      const w = img.naturalWidth * scale;
      const h = img.naturalHeight * scale;
      const m = new Y.Map();
      m.set("id", uid());
      m.set("url", up.url);
      m.set("x", (W - w) / 2);
      m.set("y", (H - h) / 2);
      m.set("w", w);
      m.set("h", h);
      m.set("rot", 0);
      images.push([m]);
      imgCache.current.set(up.url, img);
      selectImage(m.get("id"));
      setTool("select");
      redraw();
    };
    img.src = up.url;
  }

  // ---- selected-image actions -------------------------------------------
  function withSelected(fn: (m: Y.Map<any>, i: number) => void) {
    const idv = selectedRef.current;
    if (!idv) return;
    const found = imgById(idv);
    if (found) collab.doc.transact(() => fn(found.m, found.i));
  }
  const rotateSel = (deg: number) =>
    withSelected((m) => m.set("rot", ((m.get("rot") as number) || 0) + (deg * Math.PI) / 180));
  const scaleSel = (f: number) =>
    withSelected((m) => {
      const w = (m.get("w") as number) * f;
      const h = (m.get("h") as number) * f;
      const cx = (m.get("x") as number) + (m.get("w") as number) / 2;
      const cy = (m.get("y") as number) + (m.get("h") as number) / 2;
      m.set("w", w);
      m.set("h", h);
      m.set("x", cx - w / 2);
      m.set("y", cy - h / 2);
    });
  function bringFront() {
    withSelected((m, i) => {
      const data: Record<string, any> = {};
      m.forEach((v, k) => (data[k] = v));
      images.delete(i, 1);
      const clone = new Y.Map();
      Object.entries(data).forEach(([k, v]) => clone.set(k, v));
      images.push([clone]);
    });
  }
  function deleteSel() {
    withSelected((_m, i) => images.delete(i, 1));
    selectImage(null);
  }

  // ---- zoom / pan --------------------------------------------------------
  function zoomAt(cx: number, cy: number, factor: number) {
    userAdjusted.current = true;
    const v = view.current;
    const ns = Math.max(MIN_SCALE, Math.min(MAX_SCALE, v.scale * factor));
    const wx = (cx - v.x) / v.scale;
    const wy = (cy - v.y) / v.scale;
    v.scale = ns;
    v.x = cx - wx * ns;
    v.y = cy - wy * ns;
    redraw();
    rerender();
  }
  function zoomButton(factor: number) {
    const c = canvasRef.current;
    zoomAt(c ? c.clientWidth / 2 : size.w / 2, c ? c.clientHeight / 2 : size.h / 2, factor);
  }
  // Scale + center the whole W×H board inside the available CSS pixels.
  function fitInto(cw: number, ch: number) {
    const scale = Math.min(cw / W, ch / H) * 0.95;
    view.current = {
      scale,
      x: (cw - W * scale) / 2,
      y: (ch - H * scale) / 2,
    };
  }
  function fitView() {
    userAdjusted.current = false; // re-enable auto-fit (follow resizes again)
    const c = canvasRef.current;
    fitInto(c?.clientWidth || size.w, c?.clientHeight || size.h);
    redraw();
    rerender();
  }
  function centerOnWorld(wx: number, wy: number) {
    userAdjusted.current = true;
    const c = canvasRef.current;
    const cw = c?.clientWidth || size.w;
    const ch = c?.clientHeight || size.h;
    const v = view.current;
    v.x = cw / 2 - wx * v.scale;
    v.y = ch / 2 - wy * v.scale;
    redraw();
    rerender();
  }
  function miniNavigate(e: { clientX: number; clientY: number }) {
    const mc = miniRef.current;
    if (!mc) return;
    const rect = mc.getBoundingClientRect();
    const s = Math.min(rect.width / W, rect.height / H);
    centerOnWorld((e.clientX - rect.left) / s, (e.clientY - rect.top) / s);
  }

  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      zoomAt(e.clientX - rect.left, e.clientY - rect.top, e.deltaY < 0 ? 1.1 : 1 / 1.1);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep the canvas backing store matched to its CSS size (DPR-aware) so the
  // board fills the whole container and stays crisp when the panel is resized.
  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const sync = () => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      if (!w || !h) return;
      const dpr = window.devicePixelRatio || 1;
      el.width = Math.round(w * dpr);
      el.height = Math.round(h * dpr);
      setSize((prev) => (prev.w === w && prev.h === h ? prev : { w, h }));
      // Re-fit on every resize until the user has chosen their own pan/zoom.
      // This corrects the too-small first measurement (layout not settled yet).
      if (!userAdjusted.current) fitInto(w, h);
      redraw();
    };
    sync();
    const ro = new ResizeObserver(sync);
    ro.observe(el);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    collab.awareness.setLocalStateField("user", { name: user?.name, color: user?.color });
    const updateAwareness = () => {
      const others: { name: string; color: string }[] = [];
      const remote: { id: number; name: string; color: string; x: number; y: number }[] = [];
      collab.awareness.getStates().forEach((s: any, cid: number) => {
        if (cid === collab.doc.clientID || !s.user) return;
        others.push(s.user);
        if (s.cursor && typeof s.cursor.x === "number") {
          remote.push({ id: cid, name: s.user.name, color: s.user.color, x: s.cursor.x, y: s.cursor.y });
        }
      });
      setPeers(others);
      setCursors(remote);
    };
    collab.awareness.on("change", updateAwareness);
    updateAwareness();

    const observer = () => {
      redraw();
      rerender(); // keep comment pins in sync
    };
    strokes.observe(observer);
    images.observeDeep(observer);
    comments.observeDeep(observer);
    redraw();

    return () => {
      strokes.unobserve(observer);
      images.unobserveDeep(observer);
      comments.unobserveDeep(observer);
      collab.awareness.off("change", updateAwareness);
      collab.destroy();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [collab, strokes, images, comments, user]);

  // ---- pointer handling --------------------------------------------------
  function eraseAt(wx: number, wy: number) {
    const r = 14 / view.current.scale;
    let removed = false;
    collab.doc.transact(() => {
      for (let i = strokes.length - 1; i >= 0; i--) {
        const s = strokes.get(i);
        const hit = s.points.some((p, k) =>
          k === 0
            ? Math.hypot(p[0] - wx, p[1] - wy) < r
            : segDist(wx, wy, s.points[k - 1][0], s.points[k - 1][1], p[0], p[1]) < r
        );
        if (hit) {
          strokes.delete(i, 1);
          removed = true;
        }
      }
    });
    if (removed) redraw();
  }

  function onDown(e: React.PointerEvent) {
    try {
      (e.target as Element).setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    const [wx, wy] = toWorld(e);
    const t = toolRef.current;

    if (t === "pan") {
      const [cx, cy] = toCanvasPx(e);
      panning.current = { lx: cx, ly: cy };
      return;
    }
    if (t === "comment") {
      const m = new Y.Map();
      const cid = uid();
      m.set("id", cid);
      m.set("x", wx);
      m.set("y", wy);
      m.set("text", "");
      m.set("author", user?.name || "anon");
      m.set("color", user?.color || "#8b5cf6");
      comments.push([m]);
      setEditComment(cid);
      return;
    }
    if (t === "select") {
      for (let i = images.length - 1; i >= 0; i--) {
        const im = images.get(i);
        if (hitImage(wx, wy, im)) {
          selectImage(im.get("id"));
          dragImg.current = {
            m: im,
            ox: wx - (im.get("x") as number),
            oy: wy - (im.get("y") as number),
            startX: im.get("x"),
            startY: im.get("y"),
          };
          return;
        }
      }
      selectImage(null);
      return;
    }
    if (t === "eraser") {
      eraseAt(wx, wy);
      drawing.current = { points: [[wx, wy]], color: "__erase__", width };
      return;
    }
    // pen
    drawing.current = { points: [[wx, wy]], color, width };
    redraw();
  }

  function hitImage(wx: number, wy: number, im: Y.Map<any>) {
    const x = im.get("x") as number,
      y = im.get("y") as number,
      w = im.get("w") as number,
      h = im.get("h") as number,
      rot = (im.get("rot") as number) || 0;
    const cx = x + w / 2,
      cy = y + h / 2;
    const dx = wx - cx,
      dy = wy - cy;
    const lx = dx * Math.cos(-rot) - dy * Math.sin(-rot);
    const ly = dx * Math.sin(-rot) + dy * Math.cos(-rot);
    return Math.abs(lx) <= w / 2 && Math.abs(ly) <= h / 2;
  }

  function onMove(e: React.PointerEvent) {
    const [wx, wy] = toWorld(e);
    publishCursor(wx, wy);
    if (panning.current) {
      userAdjusted.current = true;
      const [cx, cy] = toCanvasPx(e);
      view.current.x += cx - panning.current.lx;
      view.current.y += cy - panning.current.ly;
      panning.current = { lx: cx, ly: cy };
      redraw();
      rerender();
      return;
    }
    if (dragImg.current) {
      const d = dragImg.current;
      d.m.set("x", wx - d.ox);
      d.m.set("y", wy - d.oy);
      redraw();
      return;
    }
    if (drawing.current) {
      if (drawing.current.color === "__erase__") {
        eraseAt(wx, wy);
        drawing.current.points.push([wx, wy]);
        return;
      }
      drawing.current.points.push([wx, wy]);
      redraw();
    }
  }

  function onUp() {
    panning.current = null;
    if (dragImg.current) {
      dragImg.current = null;
      redraw();
      return;
    }
    if (drawing.current) {
      if (drawing.current.color !== "__erase__" && drawing.current.points.length > 0) {
        strokes.push([drawing.current]);
      }
      drawing.current = null;
      redraw();
    }
  }
  function onLeave() {
    onUp();
    collab.awareness.setLocalStateField("cursor", null);
  }

  function setCommentField(cid: string, key: string, value: string) {
    for (let i = 0; i < comments.length; i++) {
      if (comments.get(i).get("id") === cid) {
        comments.get(i).set(key, value);
        return;
      }
    }
  }
  function deleteComment(cid: string) {
    for (let i = 0; i < comments.length; i++) {
      if (comments.get(i).get("id") === cid) {
        comments.delete(i, 1);
        if (editComment === cid) setEditComment(null);
        return;
      }
    }
  }

  function clear() {
    if (!confirm("Clear the whiteboard (drawings, images and comments) for everyone?")) return;
    collab.doc.transact(() => {
      strokes.delete(0, strokes.length);
      images.delete(0, images.length);
      comments.delete(0, comments.length);
    });
    selectImage(null);
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      const map: Record<string, Tool> = {
        "1": "select",
        "2": "pen",
        "3": "eraser",
        "4": "image",
        "5": "comment",
        "6": "pan",
      };
      if (map[e.key]) {
        if (map[e.key] === "image") imageFile.current?.click();
        else setTool(map[e.key]);
      }
      if ((e.key === "Delete" || e.key === "Backspace") && selectedRef.current) deleteSel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const TOOLS: { key: Tool; icon: typeof Pencil; label: string }[] = [
    { key: "select", icon: MousePointer2, label: "Select / move (1)" },
    { key: "pen", icon: Pencil, label: "Pen (2)" },
    { key: "eraser", icon: Eraser, label: "Eraser (3)" },
    { key: "image", icon: ImagePlus, label: "Image (4)" },
    { key: "comment", icon: MessageCircle, label: "Comment (5)" },
    { key: "pan", icon: Hand, label: "Pan (6)" },
  ];

  const cursorStyle =
    tool === "pan" ? (panning.current ? "grabbing" : "grab") : tool === "select" ? "default" : "crosshair";
  const scalePct = Math.round(view.current.scale * 100);

  return (
    <div className="relative flex h-full flex-col">
      <header className="surface flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-[var(--c-border)] px-4 py-3 pl-14 md:pl-4">
        <Pencil size={18} className="text-[var(--c-muted)]" />
        <div className="font-semibold">{title}</div>
        <BoardActions id={id} name={title} />

        <div className="mx-3 flex items-center gap-1.5">
          {COLORS.map((c) => (
            <button
              key={c}
              onClick={() => {
                setColor(c);
                if (tool !== "pen") setTool("pen");
              }}
              className={`h-5 w-5 rounded-full border-2 transition ${
                color === c ? "border-[var(--c-text)] scale-110" : "border-[var(--c-border)]"
              }`}
              style={{ background: c }}
            />
          ))}
          <input
            type="range"
            min={1}
            max={24}
            value={width}
            onChange={(e) => setWidth(Number(e.target.value))}
            className="ml-2 w-20"
            title="Brush size"
          />
        </div>

        <button className="btn ml-auto !py-1.5 text-xs" onClick={clear}>
          <Trash2 size={14} /> Clear
        </button>
        <input
          ref={imageFile}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            addImage(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
        <div className="flex -space-x-2">
          {peers.map((p, i) => (
            <span
              key={i}
              title={p.name}
              className="grid h-7 w-7 place-items-center rounded-full border-2 border-[var(--c-surface)] text-xs font-semibold text-white"
              style={{ background: p.color }}
            >
              {p.name?.charAt(0).toUpperCase()}
            </span>
          ))}
        </div>
      </header>

      <div className="relative min-h-0 flex-1 overflow-hidden bg-[var(--c-bg)]">
        <canvas
          ref={canvasRef}
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerLeave={onLeave}
          className="absolute inset-0 h-full w-full touch-none"
          style={{ cursor: cursorStyle }}
        />

        {/* Remote cursors */}
        <div className="pointer-events-none absolute inset-0 overflow-hidden">
          {cursors.map((c) => {
            const p = project(c.x, c.y);
            return (
              <div key={c.id} className="absolute" style={{ left: p.left, top: p.top }}>
                <div
                  className="h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow"
                  style={{ background: c.color }}
                />
                <div
                  className="absolute left-2 top-2 whitespace-nowrap rounded px-1 text-[10px] font-medium text-white shadow"
                  style={{ background: c.color }}
                >
                  {c.name}
                </div>
              </div>
            );
          })}
        </div>

        {/* Comment pins (container ignores pointers; pins opt back in) */}
        <div className="pointer-events-none absolute inset-0 overflow-hidden">
          {comments.toArray().map((m) => {
            const cid = m.get("id") as string;
            const p = project(m.get("x"), m.get("y"));
            if (p.left < -40 || p.left > size.w + 40 || p.top < -40 || p.top > size.h + 40)
              return null;
            const cc = (m.get("color") as string) || "#8b5cf6";
            return (
              <button
                key={cid}
                className="pointer-events-auto absolute -translate-x-1/2 -translate-y-full"
                style={{ left: p.left, top: p.top }}
                onClick={() => setEditComment(cid)}
                title={`${m.get("author")}: ${m.get("text") || "(empty)"}`}
              >
                <span
                  className="grid h-7 w-7 place-items-center rounded-full rounded-bl-none border-2 border-white text-white shadow-md"
                  style={{ background: cc }}
                >
                  <MessageCircle size={14} />
                </span>
              </button>
            );
          })}
        </div>

        {/* Selected-image action bar */}
        {selected && tool === "select" && (
          <div className="card absolute left-1/2 top-6 z-10 flex -translate-x-1/2 items-center gap-1 p-1 shadow-xl fade-in">
            <ActBtn onClick={() => rotateSel(-15)} title="Rotate left"><RotateCcw size={15} /></ActBtn>
            <ActBtn onClick={() => rotateSel(15)} title="Rotate right"><RotateCw size={15} /></ActBtn>
            <ActBtn onClick={() => scaleSel(1.1)} title="Bigger"><Maximize2 size={15} /></ActBtn>
            <ActBtn onClick={() => scaleSel(1 / 1.1)} title="Smaller"><Minimize2 size={15} /></ActBtn>
            <ActBtn onClick={bringFront} title="Bring to front"><ArrowUpToLine size={15} /></ActBtn>
            <ActBtn onClick={deleteSel} title="Delete image" danger><Trash2 size={15} /></ActBtn>
          </div>
        )}

        {/* Minimap */}
        {showMini && (
          <div className="card absolute bottom-16 right-5 z-10 overflow-hidden p-1 fade-in">
            <canvas
              ref={miniRef}
              width={160}
              height={100}
              onPointerDown={(e) => {
                miniDrag.current = true;
                (e.target as Element).setPointerCapture(e.pointerId);
                miniNavigate(e);
              }}
              onPointerMove={(e) => miniDrag.current && miniNavigate(e)}
              onPointerUp={() => (miniDrag.current = false)}
              className="block cursor-pointer rounded"
              style={{ width: 160, height: 100 }}
              title="Minimap — click or drag to navigate"
            />
          </div>
        )}

        {/* Zoom + view controls */}
        <div className="card absolute bottom-5 right-5 z-10 flex items-center gap-0.5 p-1 text-xs">
          <ActBtn onClick={() => zoomButton(1 / 1.2)} title="Zoom out"><ZoomOut size={15} /></ActBtn>
          <button className="w-12 text-center tabular-nums text-[var(--c-muted)]" onClick={fitView} title="Fit board to view">
            {scalePct}%
          </button>
          <ActBtn onClick={() => zoomButton(1.2)} title="Zoom in"><ZoomIn size={15} /></ActBtn>
          <ActBtn onClick={fitView} title="Fit board to view"><Maximize size={15} /></ActBtn>
          <button
            onClick={() => setShowMini((v) => !v)}
            title={showMini ? "Hide minimap" : "Show minimap"}
            className={`grid h-8 w-8 place-items-center rounded-lg transition hover:bg-[var(--c-elevated)] ${
              showMini ? "text-[var(--c-accent)]" : "text-[var(--c-muted)] hover:text-[var(--c-text)]"
            }`}
          >
            <MapIcon size={15} />
          </button>
        </div>

        {/* Minecraft-style tool hotbar */}
        <div
          className="absolute bottom-5 left-1/2 z-10 flex -translate-x-1/2 gap-0"
          style={{ background: "#c6c6c6", padding: 4, border: "3px solid #373737", imageRendering: "pixelated" }}
        >
          {TOOLS.map((t, i) => {
            const Icon = t.icon;
            const activeTool = tool === t.key && t.key !== "image";
            return (
              <button
                key={t.key}
                title={t.label}
                onClick={() => (t.key === "image" ? imageFile.current?.click() : setTool(t.key))}
                className="relative grid place-items-center"
                style={{
                  width: 48,
                  height: 48,
                  background: "#8b8b8b",
                  borderTop: "3px solid #373737",
                  borderLeft: "3px solid #373737",
                  borderBottom: "3px solid #ffffff",
                  borderRight: "3px solid #ffffff",
                  boxShadow: activeTool ? "0 0 0 3px #ffffff, 0 0 0 6px #000000" : undefined,
                  zIndex: activeTool ? 1 : 0,
                }}
              >
                <Icon size={22} color="#2b2b2b" strokeWidth={2.5} />
                <span
                  className="absolute bottom-0 right-0.5 font-bold leading-none"
                  style={{ fontSize: 10, color: "#373737", fontFamily: "monospace" }}
                >
                  {i + 1}
                </span>
              </button>
            );
          })}
        </div>

        {/* Comment editor */}
        {editComment && (() => {
          const found = comments.toArray().find((m) => m.get("id") === editComment);
          if (!found) return null;
          const p = project(found.get("x"), found.get("y"));
          const text = (found.get("text") as string) || "";
          const mentions = (text.match(/@[\w.\-]+/g) || []).map((s) => s.slice(1));
          return (
            <div
              className="card absolute z-20 w-64 p-2 shadow-2xl fade-in"
              style={{
                left: `min(max(${p.left}px, 9rem), calc(100% - 9rem))`,
                top: `min(max(${p.top}px, 1rem), calc(100% - 12rem))`,
                transform: "translate(-50%, 8px)",
              }}
            >
              <div className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-[var(--c-muted)]">
                <MessageCircle size={13} style={{ color: found.get("color") as string }} />
                {found.get("author")}
                <button className="ml-auto hover:text-red-300" onClick={() => deleteComment(editComment!)} title="Delete">
                  <Trash2 size={13} />
                </button>
                <button className="hover:text-[var(--c-text)]" onClick={() => setEditComment(null)} title="Close">
                  <X size={13} />
                </button>
              </div>
              <textarea
                autoFocus
                className="input min-h-[3em] resize-none text-sm"
                placeholder="Write a comment… tag with @name"
                value={text}
                onChange={(e) => setCommentField(editComment!, "text", e.target.value)}
              />
              <div className="mt-1.5 flex flex-wrap items-center gap-1">
                <span className="text-[10px] uppercase tracking-wide text-[var(--c-muted)]">Tag:</span>
                {members.slice(0, 8).map((m) => {
                  const on = mentions.includes(m.name);
                  return (
                    <button
                      key={m.name}
                      onClick={() => {
                        if (on) return;
                        const next = (text ? text.replace(/\s*$/, "") + " " : "") + "@" + m.name + " ";
                        setCommentField(editComment!, "text", next);
                      }}
                      className={`rounded-full px-1.5 py-0.5 text-[11px] ${
                        on
                          ? "bg-[var(--c-accent)] text-white"
                          : "bg-[var(--c-elevated)] text-[var(--c-muted)] hover:text-[var(--c-text)]"
                      }`}
                    >
                      @{m.name}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })()}
      </div>
    </div>
  );
}

function ActBtn({
  children,
  onClick,
  title,
  danger,
}: {
  children: React.ReactNode;
  onClick: () => void;
  title: string;
  danger?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={`grid h-8 w-8 place-items-center rounded-lg text-[var(--c-muted)] transition hover:bg-[var(--c-elevated)] ${
        danger ? "hover:text-red-300" : "hover:text-[var(--c-text)]"
      }`}
    >
      {children}
    </button>
  );
}
