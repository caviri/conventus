import { useEffect, useMemo, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { api } from "../api";
import { useStore } from "../store";
import { createCollab } from "../collab";
import { getMapStyleOverride, saveMapStyleOverride } from "../mapstyle";
import BoardActions from "./BoardActions";
import type { Board, MapFeature } from "../types";
import {
  Map as MapIcon,
  MapPin,
  Route,
  Hand,
  PenLine,
  Type,
  ImagePlus,
  Layers,
  Globe,
  LocateFixed,
  Eye,
  EyeOff,
  Crosshair,
  Check,
  X,
  Trash2,
} from "lucide-react";

// A collaborative map: annotations (pins, paths, freehand drawings, story-style
// text, images) live in the board's Yjs doc — everyone draws on the same map in
// real time, phone fingers included. Live positions ride on Yjs *awareness*,
// ephemeral by design: your marker exists only while you're sharing and
// vanishes when you stop, leave, or your chosen timer runs out. Only
// annotations you explicitly place are persisted.

const FALLBACK_STYLE = "https://demotiles.maplibre.org/style.json";

const SHARE_CHOICES = [
  { label: "15 minutes", minutes: 15 },
  { label: "1 hour", minutes: 60 },
  { label: "Until I stop", minutes: null },
] as const;

// In-map base-style choices. Picking one persists as the same per-user override
// that Settings → Maps edits; "Room default" clears it.
const STYLE_PRESETS = [
  { label: "Liberty", url: "https://tiles.openfreemap.org/styles/liberty" },
  { label: "Bright", url: "https://tiles.openfreemap.org/styles/bright" },
  { label: "Positron", url: "https://tiles.openfreemap.org/styles/positron" },
  { label: "Room default", url: null },
] as const;

type Tool = "pan" | "pin" | "path" | "draw" | "text";

const SIZE_RANGE: Record<string, { min: number; max: number; def: number }> = {
  text: { min: 14, max: 72, def: 28 },
  image: { min: 80, max: 480, def: 220 },
  draw: { min: 2, max: 14, def: 4 },
};

type LivePeer = {
  key: number;
  name: string;
  color: string;
  lng: number;
  lat: number;
  until: number | null;
};

function uid(): string {
  return crypto.randomUUID().replace(/-/g, "");
}

function isLine(f: MapFeature): boolean {
  return f.kind === "path" || f.kind === "draw";
}

// Paths and freehand strokes render as line layers; hand-placed paths also get
// their vertices ("nodes") as circles so the shape is editable at a glance.
function toGeoJSON(features: MapFeature[]) {
  const out: any[] = [];
  for (const f of features) {
    if (!isLine(f)) continue;
    out.push({
      type: "Feature",
      properties: { id: f.id, color: f.color, kind: f.kind, size: f.size || SIZE_RANGE.draw.def },
      geometry: { type: "LineString", coordinates: f.coords },
    });
    if (f.kind === "path")
      for (const c of f.coords as number[][])
        out.push({
          type: "Feature",
          properties: { id: f.id, color: f.color, kind: "node" },
          geometry: { type: "Point", coordinates: c },
        });
  }
  return { type: "FeatureCollection", features: out } as any;
}

function lineCenter(coords: number[][]): [number, number] {
  let lng = 0;
  let lat = 0;
  for (const c of coords) {
    lng += c[0];
    lat += c[1];
  }
  return [lng / coords.length, lat / coords.length];
}

// Ink colors for recoloring an annotation (the default is the author's color).
const INK = ["#e8b24a", "#5a9367", "#4f8a8b", "#c97b4a", "#7c6bd6", "#b5563f"];

function liveMarkerEl(name: string, color: string): HTMLElement {
  const el = document.createElement("div");
  el.style.cssText = "display:flex;flex-direction:column;align-items:center;gap:2px;";
  const dot = document.createElement("div");
  dot.style.cssText = `width:14px;height:14px;border-radius:9999px;background:${color};border:2.5px solid white;box-shadow:0 0 0 4px ${color}55, 0 1px 4px rgba(0,0,0,.4);`;
  const tag = document.createElement("div");
  tag.textContent = name;
  tag.style.cssText = `padding:1px 6px;border-radius:6px;background:${color};color:white;font-size:10px;font-weight:600;white-space:nowrap;box-shadow:0 1px 3px rgba(0,0,0,.3);`;
  el.append(dot, tag);
  return el;
}

// A popped-up label bubble carrying the annotation's text and its author, in
// the author's color — identity stays readable even when colors are similar.
function bubbleEl(f: MapFeature): HTMLElement {
  const b = document.createElement("div");
  b.style.cssText =
    `display:flex;flex-direction:column;align-items:center;padding:3px 9px;border-radius:10px;` +
    `background:${f.color};color:#fff;box-shadow:0 2px 8px rgba(0,0,0,.35);max-width:220px;`;
  const l = document.createElement("div");
  l.textContent = f.label;
  l.style.cssText = "font-size:12px;font-weight:700;line-height:1.25;text-align:center;white-space:pre-wrap;";
  const a = document.createElement("div");
  a.textContent = f.author;
  a.style.cssText = "font-size:9px;opacity:.85;";
  b.append(l, a);
  return b;
}

// Pins, text, images and line labels render as DOM markers (constant screen
// size, like story stickers) so they stay crisp and finger-draggable at any
// zoom — and labels are always visible, no click needed.
function renderDomMarker(el: HTMLElement, f: MapFeature) {
  el.innerHTML = "";
  if (f.kind === "pin") {
    el.style.display = "flex";
    el.style.flexDirection = "column";
    el.style.alignItems = "center";
    el.style.gap = "2px";
    if (f.label) el.appendChild(bubbleEl(f));
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("width", "30");
    svg.setAttribute("height", "30");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.innerHTML =
      `<path d="M12 2c-3.9 0-7 3.1-7 7 0 5.2 7 13 7 13s7-7.8 7-13c0-3.9-3.1-7-7-7z" ` +
      `fill="${f.color}" stroke="white" stroke-width="1.6"/>` +
      `<circle cx="12" cy="9" r="2.6" fill="white"/>`;
    el.appendChild(svg);
  } else if (f.kind === "text") {
    const t = document.createElement("div");
    t.textContent = f.label || "…";
    t.style.cssText =
      `font-weight:800;line-height:1.15;text-align:center;white-space:pre-wrap;` +
      `max-width:280px;color:${f.color};font-size:${f.size || SIZE_RANGE.text.def}px;` +
      `text-shadow:0 1px 2px rgba(0,0,0,.55), 0 0 12px rgba(0,0,0,.3);`;
    el.appendChild(t);
  } else if (f.kind === "image") {
    const img = document.createElement("img");
    img.src = f.url || "";
    img.draggable = false;
    img.style.cssText =
      `width:${f.size || SIZE_RANGE.image.def}px;border-radius:10px;display:block;` +
      `box-shadow:0 4px 14px rgba(0,0,0,.35);border:2px solid rgba(255,255,255,.85);`;
    el.appendChild(img);
  } else {
    // A path/draw label, floated at the shape's center.
    el.appendChild(bubbleEl(f));
  }
}

const KIND_ICON = {
  pin: MapPin,
  path: Route,
  draw: PenLine,
  text: Type,
  image: ImagePlus,
} as const;

export default function MapBoard({ board }: { board: Board }) {
  const user = useStore((s) => s.user);
  const collab = useMemo(() => createCollab(board.doc), [board.doc]);
  const yFeatures = useMemo(() => collab.doc.getArray<MapFeature>("features"), [collab]);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const liveMarkersRef = useRef<Map<number, maplibregl.Marker>>(new Map());
  const domMarkersRef = useRef<Map<string, { marker: maplibregl.Marker; el: HTMLElement }>>(
    new Map()
  );
  const toolRef = useRef<Tool>("pan");
  const draftRef = useRef<number[][]>([]);
  const drawPtsRef = useRef<number[][]>([]);
  const watchIdRef = useRef<number | null>(null);
  const shareTimerRef = useRef<number>(0);
  const serverStyleRef = useRef<string>("");
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const didFitRef = useRef(false);

  const [ready, setReady] = useState(false);
  const [styleTick, setStyleTick] = useState(0);
  const [tool, setToolState] = useState<Tool>("pan");
  const [draftLen, setDraftLen] = useState(0);
  const [, setDrawTick] = useState(0);
  const [features, setFeatures] = useState<MapFeature[]>([]);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<string | null>(null);
  const [label, setLabel] = useState("");
  const [peers, setPeers] = useState<{ name: string; color: string }[]>([]);
  const [sharing, setSharing] = useState<{ until: number | null } | null>(null);
  const [shareOpen, setShareOpen] = useState(false);
  const [layersOpen, setLayersOpen] = useState(false);
  const [styleOpen, setStyleOpen] = useState(false);
  const [notice, setNotice] = useState("");

  function setTool(t: Tool) {
    toolRef.current = t;
    setToolState(t);
    const map = mapRef.current;
    if (map) map.getCanvas().style.cursor = t === "pan" ? "" : "crosshair";
    if (t !== "path") clearDraft();
  }

  function clearDraft() {
    draftRef.current = [];
    setDraftLen(0);
    syncDraft();
  }

  function syncDraft() {
    const src = mapRef.current?.getSource("draft") as maplibregl.GeoJSONSource | undefined;
    const pts = draftRef.current;
    const features: any[] = pts.map((c) => ({
      type: "Feature",
      properties: {},
      geometry: { type: "Point", coordinates: c },
    }));
    if (pts.length >= 2)
      features.push({
        type: "Feature",
        properties: {},
        geometry: { type: "LineString", coordinates: pts },
      });
    src?.setData({ type: "FeatureCollection", features } as any);
  }

  // --- Shared feature mutations ---------------------------------------------
  function addFeature(f: MapFeature) {
    yFeatures.push([f]);
  }

  function updateFeature(id: string, patch: Partial<MapFeature>) {
    const idx = yFeatures.toArray().findIndex((f) => f.id === id);
    if (idx < 0) return;
    const merged = { ...yFeatures.get(idx), ...patch };
    collab.doc.transact(() => {
      yFeatures.delete(idx, 1);
      yFeatures.insert(idx, [merged]);
    });
  }

  function deleteFeature(id: string) {
    const idx = yFeatures.toArray().findIndex((f) => f.id === id);
    if (idx >= 0) yFeatures.delete(idx, 1);
    setSelected(null);
  }

  function finishPath() {
    if (draftRef.current.length >= 2 && user) {
      addFeature({
        id: uid(),
        kind: "path",
        coords: [...draftRef.current],
        label: "",
        color: user.color,
        author: user.name,
      });
    }
    clearDraft();
    setTool("pan");
  }

  // --- Freehand drawing (touch-friendly overlay) -----------------------------
  function drawPoint(e: React.PointerEvent): [number, number] {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  }

  function onDrawStart(e: React.PointerEvent) {
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    drawPtsRef.current = [drawPoint(e)];
    setDrawTick((t) => t + 1);
  }

  function onDrawMove(e: React.PointerEvent) {
    if (!drawPtsRef.current.length) return;
    const [x, y] = drawPoint(e);
    const last = drawPtsRef.current[drawPtsRef.current.length - 1];
    if (Math.hypot(x - last[0], y - last[1]) < 3) return;
    drawPtsRef.current.push([x, y]);
    setDrawTick((t) => t + 1);
  }

  function onDrawEnd() {
    const pts = drawPtsRef.current;
    drawPtsRef.current = [];
    setDrawTick((t) => t + 1);
    const map = mapRef.current;
    if (!map || pts.length < 2 || !user) return;
    const coords = pts.map(([x, y]) => {
      const p = map.unproject([x, y]);
      return [p.lng, p.lat];
    });
    addFeature({
      id: uid(),
      kind: "draw",
      coords,
      label: "",
      color: user.color,
      author: user.name,
      size: SIZE_RANGE.draw.def,
    });
  }

  // --- Images ----------------------------------------------------------------
  async function onImagePicked(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    const map = mapRef.current;
    if (!file || !user || !map) return;
    try {
      const up = await api.upload(file);
      const c = map.getCenter();
      const f: MapFeature = {
        id: uid(),
        kind: "image",
        coords: [c.lng, c.lat],
        label: file.name,
        color: user.color,
        author: user.name,
        size: SIZE_RANGE.image.def,
        url: (up as any).url,
      };
      addFeature(f);
      setSelected(f.id);
    } catch {
      setNotice("Image upload failed.");
    }
  }

  // --- Live location ----------------------------------------------------------
  function startShare(minutes: number | null) {
    setShareOpen(false);
    if (!navigator.geolocation) {
      setNotice("This browser has no geolocation.");
      return;
    }
    const until = minutes ? Date.now() + minutes * 60_000 : null;
    setSharing({ until });
    setNotice("");
    watchIdRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        collab.awareness.setLocalStateField("loc", {
          lng: pos.coords.longitude,
          lat: pos.coords.latitude,
          acc: pos.coords.accuracy,
          until,
        });
      },
      () => {
        setNotice("Couldn't get your location (permission denied?).");
        stopShare();
      },
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 }
    );
    if (until) shareTimerRef.current = window.setTimeout(stopShare, until - Date.now());
  }

  function stopShare() {
    if (watchIdRef.current != null) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
    clearTimeout(shareTimerRef.current);
    collab.awareness.setLocalStateField("loc", null);
    setSharing(null);
  }

  function syncLiveMarkers() {
    const map = mapRef.current;
    if (!map) return;
    const now = Date.now();
    const live: LivePeer[] = [];
    collab.awareness.getStates().forEach((s: any, id: number) => {
      const loc = s.loc;
      if (!loc || (loc.until && loc.until < now) || !s.user?.name) return;
      live.push({ key: id, name: s.user.name, color: s.user.color || "#e8b24a", ...loc });
    });
    const seen = new Set<number>();
    for (const p of live) {
      seen.add(p.key);
      const existing = liveMarkersRef.current.get(p.key);
      if (existing) {
        existing.setLngLat([p.lng, p.lat]);
      } else {
        const marker = new maplibregl.Marker({ element: liveMarkerEl(p.name, p.color) })
          .setLngLat([p.lng, p.lat])
          .addTo(map);
        liveMarkersRef.current.set(p.key, marker);
      }
    }
    for (const [key, marker] of liveMarkersRef.current) {
      if (!seen.has(key)) {
        marker.remove();
        liveMarkersRef.current.delete(key);
      }
    }
  }

  // --- DOM markers: pins, text, images, and line labels -------------------------
  function syncDomMarkers(list: MapFeature[], hiddenSet: Set<string>) {
    const map = mapRef.current;
    if (!map) return;
    type Want = { f: MapFeature; pos: [number, number]; anchor: "bottom" | "center"; drag: boolean };
    const want = new Map<string, Want>();
    for (const f of list) {
      if (hiddenSet.has(f.id)) continue;
      if (f.kind === "pin") {
        want.set(f.id, { f, pos: f.coords as [number, number], anchor: "bottom", drag: true });
      } else if (f.kind === "text" || f.kind === "image") {
        want.set(f.id, { f, pos: f.coords as [number, number], anchor: "center", drag: true });
      } else if (isLine(f) && f.label) {
        // The shape's writing floats at its center, inside/close to it.
        want.set(`${f.id}:label`, {
          f,
          pos: lineCenter(f.coords as number[][]),
          anchor: "center",
          drag: false,
        });
      }
    }
    for (const [key, ent] of domMarkersRef.current) {
      if (!want.has(key)) {
        ent.marker.remove();
        domMarkersRef.current.delete(key);
      }
    }
    for (const [key, w] of want) {
      let ent = domMarkersRef.current.get(key);
      if (!ent) {
        const el = document.createElement("div");
        el.style.cssText = "cursor:pointer;user-select:none;-webkit-user-select:none;";
        const featureId = w.f.id;
        el.addEventListener("click", (ev) => {
          ev.stopPropagation();
          setSelected(featureId);
        });
        const marker = new maplibregl.Marker({ element: el, anchor: w.anchor, draggable: w.drag })
          .setLngLat(w.pos)
          .addTo(map);
        if (w.drag) {
          marker.on("dragend", () => {
            const p = marker.getLngLat();
            updateFeature(featureId, { coords: [p.lng, p.lat] });
          });
        }
        ent = { marker, el };
        domMarkersRef.current.set(key, ent);
      }
      ent.marker.setLngLat(w.pos);
      renderDomMarker(ent.el, w.f);
    }
  }

  // --- Base style --------------------------------------------------------------
  function switchStyle(url: string | null) {
    setStyleOpen(false);
    saveMapStyleOverride(url || "");
    mapRef.current?.setStyle(url || serverStyleRef.current || FALLBACK_STYLE);
    // "style.load" re-adds our sources/layers and bumps styleTick to resync data.
  }

  function addOverlays(map: maplibregl.Map) {
    if (map.getSource("features")) return;
    map.addSource("features", { type: "geojson", data: toGeoJSON([]) });
    map.addSource("draft", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
    map.addLayer({
      id: "paths",
      type: "line",
      source: "features",
      filter: ["==", ["get", "kind"], "path"],
      paint: { "line-color": ["get", "color"], "line-width": 3.5, "line-opacity": 0.9 },
      layout: { "line-cap": "round", "line-join": "round" },
    });
    map.addLayer({
      id: "draws",
      type: "line",
      source: "features",
      filter: ["==", ["get", "kind"], "draw"],
      paint: {
        "line-color": ["get", "color"],
        "line-width": ["get", "size"],
        "line-opacity": 0.95,
      },
      layout: { "line-cap": "round", "line-join": "round" },
    });
    map.addLayer({
      id: "nodes",
      type: "circle",
      source: "features",
      filter: ["==", ["get", "kind"], "node"],
      paint: {
        "circle-color": "#ffffff",
        "circle-radius": 4,
        "circle-stroke-width": 2.5,
        "circle-stroke-color": ["get", "color"],
      },
    });
    map.addLayer({
      id: "draft-line",
      type: "line",
      source: "draft",
      filter: ["==", ["geometry-type"], "LineString"],
      paint: { "line-color": "#e8b24a", "line-width": 2.5, "line-dasharray": [1.5, 1.5] },
    });
    map.addLayer({
      id: "draft-nodes",
      type: "circle",
      source: "draft",
      filter: ["==", ["geometry-type"], "Point"],
      paint: {
        "circle-color": "#ffffff",
        "circle-radius": 4.5,
        "circle-stroke-width": 2.5,
        "circle-stroke-color": "#e8b24a",
      },
    });
  }

  // --- Map + collab lifecycle ---------------------------------------------------
  useEffect(() => {
    let dead = false;

    (async () => {
      try {
        const cfg = await api.get<{ map_style_url?: string }>("/api/auth/config");
        serverStyleRef.current = cfg.map_style_url || "";
      } catch {
        /* fall through */
      }
      if (dead || !containerRef.current) return;

      const map = new maplibregl.Map({
        container: containerRef.current,
        style: getMapStyleOverride() || serverStyleRef.current || FALLBACK_STYLE,
        center: [8.54, 47.37],
        zoom: 3,
        attributionControl: { compact: true },
      });
      mapRef.current = map;
      map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
      map.on("error", () => {
        /* tile/style hiccups are non-fatal */
      });

      // Fires on the initial style and again after every setStyle — our
      // overlays must be re-added each time.
      map.on("style.load", () => {
        if (dead) return;
        addOverlays(map);
        syncLiveMarkers();
        setStyleTick((t) => t + 1);
        setReady(true);

        if (!didFitRef.current) {
          didFitRef.current = true;
          const feats = yFeatures.toArray();
          if (feats.length) {
            const b = new maplibregl.LngLatBounds();
            for (const f of feats) {
              if (isLine(f)) for (const c of f.coords as number[][]) b.extend(c as [number, number]);
              else b.extend(f.coords as [number, number]);
            }
            map.fitBounds(b, { padding: 80, maxZoom: 13, duration: 0 });
          }
        }
      });

      map.on("click", (e) => {
        const t = toolRef.current;
        if (t === "pin" || t === "text") {
          if (!user) return;
          const f: MapFeature = {
            id: uid(),
            kind: t,
            coords: [e.lngLat.lng, e.lngLat.lat],
            label: "",
            color: user.color,
            author: user.name,
            ...(t === "text" ? { size: SIZE_RANGE.text.def } : {}),
          };
          addFeature(f);
          setSelected(f.id);
          setTool("pan");
        } else if (t === "path") {
          draftRef.current = [...draftRef.current, [e.lngLat.lng, e.lngLat.lat]];
          setDraftLen(draftRef.current.length);
          syncDraft();
        } else {
          const hits = map.queryRenderedFeatures(e.point, { layers: ["paths", "draws", "nodes"] });
          setSelected((hits[0]?.properties as any)?.id ?? null);
        }
      });
      map.on("dblclick", (e) => {
        if (toolRef.current === "path") {
          e.preventDefault();
          finishPath();
        }
      });
    })();

    const onFeatures = () => setFeatures(yFeatures.toArray());
    yFeatures.observe(onFeatures);
    setFeatures(yFeatures.toArray());

    collab.awareness.setLocalStateField("user", { name: user?.name, color: user?.color });
    const onAwareness = () => {
      const others: { name: string; color: string }[] = [];
      collab.awareness.getStates().forEach((s: any, id: number) => {
        if (id !== collab.doc.clientID && s.user?.name) others.push(s.user);
      });
      setPeers(others);
      syncLiveMarkers();
    };
    collab.awareness.on("change", onAwareness);
    onAwareness();

    const sweep = window.setInterval(syncLiveMarkers, 15_000);

    return () => {
      dead = true;
      clearInterval(sweep);
      stopShare();
      yFeatures.unobserve(onFeatures);
      collab.awareness.off("change", onAwareness);
      for (const m of liveMarkersRef.current.values()) m.remove();
      liveMarkersRef.current.clear();
      for (const e of domMarkersRef.current.values()) e.marker.remove();
      domMarkersRef.current.clear();
      mapRef.current?.remove();
      mapRef.current = null;
      collab.destroy();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [collab]);

  // Shared annotations → the map, honoring per-user layer visibility. Re-runs
  // after every style switch (styleTick), which recreates the sources.
  useEffect(() => {
    if (!ready) return;
    const visible = features.filter((f) => !hidden.has(f.id));
    const src = mapRef.current?.getSource("features") as maplibregl.GeoJSONSource | undefined;
    src?.setData(toGeoJSON(visible));
    syncDomMarkers(features, hidden);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [features, hidden, ready, styleTick]);

  const selectedFeature = features.find((f) => f.id === selected) || null;
  useEffect(() => {
    setLabel(selectedFeature?.label || "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected]);

  function toggleHidden(id: string) {
    setHidden((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function zoomTo(f: MapFeature) {
    const map = mapRef.current;
    if (!map) return;
    setLayersOpen(false);
    if (isLine(f)) {
      const b = new maplibregl.LngLatBounds();
      for (const c of f.coords as number[][]) b.extend(c as [number, number]);
      map.fitBounds(b, { padding: 100, maxZoom: 15 });
    } else {
      map.easeTo({ center: f.coords as [number, number], zoom: Math.max(map.getZoom(), 13) });
    }
  }

  const shareLeft = sharing?.until
    ? Math.max(0, Math.round((sharing.until - Date.now()) / 60_000))
    : null;
  const drawPts = drawPtsRef.current;
  const sizeRange = selectedFeature ? SIZE_RANGE[selectedFeature.kind] : undefined;

  return (
    <div className="flex h-full flex-col">
      <header className="surface relative flex items-center gap-3 border-b border-[var(--c-border)] px-4 py-3 pl-14 md:pl-4">
        <MapIcon size={18} className="text-[var(--c-accent)]" />
        <div className="truncate font-semibold">{board.name}</div>
        <BoardActions id={board.id} name={board.name} />

        <div className="ml-auto flex items-center gap-2">
          {notice && <span className="hidden text-xs text-red-300 sm:inline">{notice}</span>}
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
          <div className="relative">
            {sharing ? (
              <button
                className="btn btn-primary !py-1.5 text-xs"
                onClick={stopShare}
                title="Stop sharing your live location"
              >
                <LocateFixed size={14} className="animate-pulse" />
                {shareLeft != null ? `Sharing · ${shareLeft}m left` : "Sharing — stop"}
              </button>
            ) : (
              <button
                className="btn !py-1.5 text-xs"
                onClick={() => setShareOpen((v) => !v)}
                title="Share your live location with the room"
              >
                <LocateFixed size={14} />
                <span className="hidden sm:inline">Share location</span>
              </button>
            )}
            {shareOpen && !sharing && (
              <>
                <div className="fixed inset-0 z-30" onClick={() => setShareOpen(false)} />
                <div className="card absolute right-0 top-full z-40 mt-1 w-44 overflow-hidden p-1 text-sm shadow-2xl fade-in">
                  {SHARE_CHOICES.map((c) => (
                    <button
                      key={c.label}
                      className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-[var(--c-elevated)]"
                      onClick={() => startShare(c.minutes)}
                    >
                      {c.label}
                    </button>
                  ))}
                  <p className="px-2 py-1 text-[10px] leading-snug text-[var(--c-muted)]">
                    Live only while this page is open; never stored.
                  </p>
                </div>
              </>
            )}
          </div>
        </div>
      </header>

      <div className="relative min-h-0 flex-1">
        <div ref={containerRef} className="h-full w-full" />
        {!ready && (
          <div className="absolute inset-0 grid place-items-center text-[var(--c-muted)]">
            Loading map…
          </div>
        )}

        {/* Freehand drawing overlay — captures mouse & touch while the draw
            tool is active; each stroke is unprojected to geo coords. */}
        {tool === "draw" && (
          <div
            className="absolute inset-0 z-20 cursor-crosshair touch-none"
            onPointerDown={onDrawStart}
            onPointerMove={onDrawMove}
            onPointerUp={onDrawEnd}
            onPointerCancel={onDrawEnd}
          >
            <svg className="h-full w-full">
              {drawPts.length > 1 && (
                <polyline
                  points={drawPts.map((p) => p.join(",")).join(" ")}
                  fill="none"
                  stroke={user?.color || "#e8b24a"}
                  strokeWidth={SIZE_RANGE.draw.def}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              )}
            </svg>
          </div>
        )}

        {/* Tool rail — inset-aware so it clears iPhone notches/corners */}
        <div
          className="absolute top-3 z-30 flex flex-col gap-1 rounded-xl border border-[var(--c-border)] bg-[var(--c-surface)] p-1 shadow-lg"
          style={{ left: "calc(0.75rem + env(safe-area-inset-left))" }}
        >
          {(
            [
              { key: "pan", icon: Hand, title: "Pan / select" },
              { key: "pin", icon: MapPin, title: "Drop a pin" },
              { key: "path", icon: Route, title: "Draw a path (double-click to finish)" },
              { key: "draw", icon: PenLine, title: "Freehand drawing" },
              { key: "text", icon: Type, title: "Place text" },
            ] as const
          ).map((t) => (
            <button
              key={t.key}
              title={t.title}
              onClick={() => setTool(tool === t.key && t.key !== "pan" ? "pan" : t.key)}
              className={`grid h-9 w-9 place-items-center rounded-lg transition ${
                tool === t.key
                  ? "bg-[var(--c-accent)] text-white"
                  : "text-[var(--c-muted)] hover:bg-[var(--c-elevated)] hover:text-[var(--c-text)]"
              }`}
            >
              <t.icon size={17} />
            </button>
          ))}
          <button
            title="Add an image"
            onClick={() => fileInputRef.current?.click()}
            className="grid h-9 w-9 place-items-center rounded-lg text-[var(--c-muted)] transition hover:bg-[var(--c-elevated)] hover:text-[var(--c-text)]"
          >
            <ImagePlus size={17} />
          </button>
          {tool === "path" && draftLen > 0 && (
            <>
              <button
                title="Finish path"
                onClick={finishPath}
                disabled={draftLen < 2}
                className="grid h-9 w-9 place-items-center rounded-lg bg-[var(--c-accent-2)] text-white disabled:opacity-40"
              >
                <Check size={17} />
              </button>
              <button
                title="Cancel path"
                onClick={clearDraft}
                className="grid h-9 w-9 place-items-center rounded-lg text-[var(--c-muted)] hover:bg-[var(--c-elevated)]"
              >
                <X size={17} />
              </button>
            </>
          )}
          <div className="my-0.5 border-t border-[var(--c-border)]" />
          <button
            title="Layers"
            onClick={() => setLayersOpen((v) => !v)}
            className={`grid h-9 w-9 place-items-center rounded-lg transition ${
              layersOpen
                ? "bg-[var(--c-accent)] text-white"
                : "text-[var(--c-muted)] hover:bg-[var(--c-elevated)] hover:text-[var(--c-text)]"
            }`}
          >
            <Layers size={17} />
          </button>
          <button
            title="Base map style"
            onClick={() => setStyleOpen((v) => !v)}
            className={`grid h-9 w-9 place-items-center rounded-lg transition ${
              styleOpen
                ? "bg-[var(--c-accent)] text-white"
                : "text-[var(--c-muted)] hover:bg-[var(--c-elevated)] hover:text-[var(--c-text)]"
            }`}
          >
            <Globe size={17} />
          </button>
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={onImagePicked}
        />

        {/* Base style picker */}
        {styleOpen && (
          <>
            <div className="fixed inset-0 z-30" onClick={() => setStyleOpen(false)} />
            <div
              className="card absolute top-3 z-40 w-48 overflow-hidden p-1 text-sm shadow-2xl fade-in"
              style={{ left: "calc(4rem + env(safe-area-inset-left))" }}
            >
              {STYLE_PRESETS.map((s) => (
                <button
                  key={s.label}
                  className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-[var(--c-elevated)]"
                  onClick={() => switchStyle(s.url)}
                >
                  <Globe size={14} className="text-[var(--c-muted)]" /> {s.label}
                </button>
              ))}
              <p className="px-2 py-1 text-[10px] leading-snug text-[var(--c-muted)]">
                Your choice, saved in this browser. A custom style URL lives in
                Settings → Maps.
              </p>
            </div>
          </>
        )}

        {/* Layers panel — every annotation, with visibility / zoom / delete */}
        {layersOpen && (
          <div
            className="card absolute top-3 z-30 flex max-h-[70%] w-72 max-w-[calc(100vw-5rem)] flex-col overflow-hidden shadow-2xl fade-in"
            style={{ left: "calc(4rem + env(safe-area-inset-left))" }}
          >
            <div className="flex items-center justify-between border-b border-[var(--c-border)] px-3 py-2 text-sm font-semibold">
              Layers ({features.length})
              <button onClick={() => setLayersOpen(false)} title="Close">
                <X size={14} />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-1">
              {features.length === 0 && (
                <p className="px-2 py-3 text-center text-xs text-[var(--c-muted)]">
                  Nothing on the map yet — drop a pin, draw, or add text.
                </p>
              )}
              {[...features].reverse().map((f) => {
                const Icon = KIND_ICON[f.kind] || MapPin;
                const off = hidden.has(f.id);
                return (
                  <div
                    key={f.id}
                    className={`flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-[var(--c-elevated)] ${
                      off ? "opacity-50" : ""
                    }`}
                  >
                    <Icon size={14} style={{ color: f.color }} className="shrink-0" />
                    <button
                      className="min-w-0 flex-1 truncate text-left"
                      onClick={() => zoomTo(f)}
                      title="Zoom to"
                    >
                      {f.label || f.kind}
                      <span className="ml-1 text-xs text-[var(--c-muted)]">· {f.author}</span>
                    </button>
                    <button onClick={() => zoomTo(f)} title="Zoom to" className="text-[var(--c-muted)] hover:text-[var(--c-text)]">
                      <Crosshair size={13} />
                    </button>
                    <button
                      onClick={() => toggleHidden(f.id)}
                      title={off ? "Show" : "Hide (just for you)"}
                      className="text-[var(--c-muted)] hover:text-[var(--c-text)]"
                    >
                      {off ? <EyeOff size={13} /> : <Eye size={13} />}
                    </button>
                    <button
                      onClick={() => deleteFeature(f.id)}
                      title="Delete for everyone"
                      className="text-[var(--c-muted)] hover:text-red-300"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Selected annotation editor */}
        {selectedFeature && (
          <div
            className="card absolute left-1/2 z-30 flex w-80 max-w-[calc(100vw-2rem)] -translate-x-1/2 flex-col gap-2 p-3 shadow-2xl fade-in"
            style={{ bottom: "calc(1rem + env(safe-area-inset-bottom))" }}
          >
            <div className="flex items-center gap-2 text-xs text-[var(--c-muted)]">
              <span
                className="inline-block h-3 w-3 rounded-full"
                style={{ background: selectedFeature.color }}
              />
              {selectedFeature.kind} by {selectedFeature.author}
              <button className="ml-auto" onClick={() => setSelected(null)} title="Close">
                <X size={14} />
              </button>
            </div>
            <div className="flex items-center gap-2">
              <input
                className="input flex-1 !py-1.5 text-sm"
                placeholder={selectedFeature.kind === "text" ? "Say something…" : "Label…"}
                value={label}
                autoFocus
                onChange={(e) => {
                  setLabel(e.target.value);
                  // Text content renders live on everyone's map as you type.
                  if (selectedFeature.kind === "text")
                    updateFeature(selectedFeature.id, { label: e.target.value });
                }}
                onBlur={() => updateFeature(selectedFeature.id, { label })}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    updateFeature(selectedFeature.id, { label });
                    setSelected(null);
                  }
                }}
              />
              <button
                className="btn !p-2 text-red-300"
                title="Delete"
                onClick={() => deleteFeature(selectedFeature.id)}
              >
                <Trash2 size={15} />
              </button>
            </div>
            {sizeRange && (
              <label className="flex items-center gap-2 text-xs text-[var(--c-muted)]">
                Size
                <input
                  type="range"
                  className="flex-1"
                  min={sizeRange.min}
                  max={sizeRange.max}
                  value={selectedFeature.size || sizeRange.def}
                  onChange={(e) => updateFeature(selectedFeature.id, { size: +e.target.value })}
                />
              </label>
            )}
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-[var(--c-muted)]">Color</span>
              {INK.map((c) => (
                <button
                  key={c}
                  title={c}
                  onClick={() => updateFeature(selectedFeature.id, { color: c })}
                  className="h-5 w-5 rounded-full border border-white/50"
                  style={{
                    background: c,
                    outline:
                      selectedFeature.color === c ? "2px solid var(--c-accent)" : "none",
                    outlineOffset: 1,
                  }}
                />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
