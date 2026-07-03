import { useEffect, useMemo, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { api } from "../api";
import { useStore } from "../store";
import { createCollab } from "../collab";
import { getMapStyleOverride } from "../mapstyle";
import BoardActions from "./BoardActions";
import type { Board, MapFeature } from "../types";
import {
  Map as MapIcon,
  MapPin,
  Route,
  Hand,
  LocateFixed,
  Check,
  X,
  Trash2,
} from "lucide-react";

// A collaborative map: pins and paths live in the board's Yjs doc (like the
// whiteboard's strokes), so everyone draws on the same map in real time. Live
// positions ride on Yjs *awareness* — ephemeral by design: your marker exists
// only while you're sharing and vanishes when you stop, leave, or the timer
// you chose runs out. Only pins/paths you explicitly drop are persisted.

const FALLBACK_STYLE = "https://demotiles.maplibre.org/style.json";

const SHARE_CHOICES = [
  { label: "15 minutes", minutes: 15 },
  { label: "1 hour", minutes: 60 },
  { label: "Until I stop", minutes: null },
] as const;

type Tool = "pan" | "pin" | "path";

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

function toGeoJSON(features: MapFeature[]) {
  return {
    type: "FeatureCollection",
    features: features.map((f) => ({
      type: "Feature",
      properties: { id: f.id, color: f.color, label: f.label, kind: f.kind },
      geometry:
        f.kind === "pin"
          ? { type: "Point", coordinates: f.coords }
          : { type: "LineString", coordinates: f.coords },
    })),
  } as any;
}

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

export default function MapBoard({ board }: { board: Board }) {
  const user = useStore((s) => s.user);
  const collab = useMemo(() => createCollab(board.doc), [board.doc]);
  const yFeatures = useMemo(() => collab.doc.getArray<MapFeature>("features"), [collab]);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markersRef = useRef<Map<number, maplibregl.Marker>>(new Map());
  const toolRef = useRef<Tool>("pan");
  const draftRef = useRef<number[][]>([]);
  const watchIdRef = useRef<number | null>(null);
  const shareTimerRef = useRef<number>(0);

  const [ready, setReady] = useState(false);
  const [tool, setToolState] = useState<Tool>("pan");
  const [draftLen, setDraftLen] = useState(0);
  const [features, setFeatures] = useState<MapFeature[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [label, setLabel] = useState("");
  const [peers, setPeers] = useState<{ name: string; color: string }[]>([]);
  const [sharing, setSharing] = useState<{ until: number | null } | null>(null);
  const [shareOpen, setShareOpen] = useState(false);
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
    const map = mapRef.current;
    const src = map?.getSource("draft") as maplibregl.GeoJSONSource | undefined;
    src?.setData({
      type: "FeatureCollection",
      features: draftRef.current.length
        ? [
            {
              type: "Feature",
              properties: {},
              geometry: { type: "LineString", coordinates: draftRef.current },
            },
          ]
        : [],
    } as any);
  }

  // --- Shared feature mutations --------------------------------------------
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

  // --- Live location --------------------------------------------------------
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
      const existing = markersRef.current.get(p.key);
      if (existing) {
        existing.setLngLat([p.lng, p.lat]);
      } else {
        const marker = new maplibregl.Marker({ element: liveMarkerEl(p.name, p.color) })
          .setLngLat([p.lng, p.lat])
          .addTo(map);
        markersRef.current.set(p.key, marker);
      }
    }
    for (const [key, marker] of markersRef.current) {
      if (!seen.has(key)) {
        marker.remove();
        markersRef.current.delete(key);
      }
    }
  }

  // --- Map + collab lifecycle ------------------------------------------------
  useEffect(() => {
    let dead = false;
    let map: maplibregl.Map | null = null;

    (async () => {
      let style = getMapStyleOverride();
      if (!style) {
        try {
          const cfg = await api.get<{ map_style_url?: string }>("/api/auth/config");
          style = cfg.map_style_url || "";
        } catch {
          /* fall through */
        }
      }
      if (dead || !containerRef.current) return;

      map = new maplibregl.Map({
        container: containerRef.current,
        style: style || FALLBACK_STYLE,
        center: [8.54, 47.37],
        zoom: 3,
        attributionControl: { compact: true },
      });
      mapRef.current = map;
      map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
      map.on("error", () => {
        /* tile/style hiccups are non-fatal; the canvas just stays blank there */
      });

      map.on("load", () => {
        if (dead || !map) return;
        map.addSource("features", { type: "geojson", data: toGeoJSON(yFeatures.toArray()) });
        map.addSource("draft", {
          type: "geojson",
          data: { type: "FeatureCollection", features: [] },
        });
        map.addLayer({
          id: "paths",
          type: "line",
          source: "features",
          filter: ["==", ["get", "kind"], "path"],
          paint: { "line-color": ["get", "color"], "line-width": 3.5, "line-opacity": 0.9 },
          layout: { "line-cap": "round", "line-join": "round" },
        });
        map.addLayer({
          id: "pins",
          type: "circle",
          source: "features",
          filter: ["==", ["get", "kind"], "pin"],
          paint: {
            "circle-color": ["get", "color"],
            "circle-radius": 7,
            "circle-stroke-width": 2.5,
            "circle-stroke-color": "#ffffff",
          },
        });
        map.addLayer({
          id: "draft-line",
          type: "line",
          source: "draft",
          paint: { "line-color": "#e8b24a", "line-width": 2.5, "line-dasharray": [1.5, 1.5] },
        });

        // Start where the annotations are, if there are any.
        const feats = yFeatures.toArray();
        if (feats.length) {
          const b = new maplibregl.LngLatBounds();
          for (const f of feats) {
            if (f.kind === "pin") b.extend(f.coords as [number, number]);
            else for (const c of f.coords as number[][]) b.extend(c as [number, number]);
          }
          map.fitBounds(b, { padding: 80, maxZoom: 13, duration: 0 });
        }

        syncLiveMarkers();
        setReady(true);
      });

      map.on("click", (e) => {
        const t = toolRef.current;
        if (t === "pin") {
          if (!user) return;
          const f: MapFeature = {
            id: uid(),
            kind: "pin",
            coords: [e.lngLat.lng, e.lngLat.lat],
            label: "",
            color: user.color,
            author: user.name,
          };
          addFeature(f);
          setSelected(f.id);
          setTool("pan");
        } else if (t === "path") {
          draftRef.current = [...draftRef.current, [e.lngLat.lng, e.lngLat.lat]];
          setDraftLen(draftRef.current.length);
          syncDraft();
        } else {
          const hits = map!.queryRenderedFeatures(e.point, { layers: ["pins", "paths"] });
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

    // Shared annotations → both the React mirror and the map source.
    const onFeatures = () => {
      const list = yFeatures.toArray();
      setFeatures(list);
      const src = mapRef.current?.getSource("features") as maplibregl.GeoJSONSource | undefined;
      src?.setData(toGeoJSON(list));
    };
    yFeatures.observe(onFeatures);
    setFeatures(yFeatures.toArray());

    // Presence: avatar row + live location markers.
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

    // Sweep expired shares even when no awareness update arrives.
    const sweep = window.setInterval(syncLiveMarkers, 15_000);

    return () => {
      dead = true;
      clearInterval(sweep);
      stopShare();
      yFeatures.unobserve(onFeatures);
      collab.awareness.off("change", onAwareness);
      for (const m of markersRef.current.values()) m.remove();
      markersRef.current.clear();
      mapRef.current?.remove();
      mapRef.current = null;
      collab.destroy();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [collab]);

  // Keep the label input in sync with the selected feature.
  const selectedFeature = features.find((f) => f.id === selected) || null;
  useEffect(() => {
    setLabel(selectedFeature?.label || "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected]);

  const shareLeft = sharing?.until
    ? Math.max(0, Math.round((sharing.until - Date.now()) / 60_000))
    : null;

  return (
    <div className="flex h-full flex-col">
      <header className="surface relative flex items-center gap-3 border-b border-[var(--c-border)] px-4 py-3 pl-14 md:pl-4">
        <MapIcon size={18} className="text-[var(--c-accent)]" />
        <div className="font-semibold">{board.name}</div>
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
                <LocateFixed size={14} /> Share location
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

        {/* Tools */}
        <div className="absolute left-3 top-3 z-10 flex flex-col gap-1 rounded-xl border border-[var(--c-border)] bg-[var(--c-surface)] p-1 shadow-lg">
          {(
            [
              { key: "pan", icon: Hand, title: "Pan / select" },
              { key: "pin", icon: MapPin, title: "Drop a pin" },
              { key: "path", icon: Route, title: "Draw a path (double-click to finish)" },
            ] as const
          ).map((t) => (
            <button
              key={t.key}
              title={t.title}
              onClick={() => setTool(t.key)}
              className={`grid h-9 w-9 place-items-center rounded-lg transition ${
                tool === t.key
                  ? "bg-[var(--c-accent)] text-white"
                  : "text-[var(--c-muted)] hover:bg-[var(--c-elevated)] hover:text-[var(--c-text)]"
              }`}
            >
              <t.icon size={17} />
            </button>
          ))}
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
        </div>

        {/* Selected annotation editor */}
        {selectedFeature && (
          <div className="card absolute bottom-4 left-1/2 z-10 flex w-80 max-w-[calc(100vw-2rem)] -translate-x-1/2 flex-col gap-2 p-3 shadow-2xl fade-in">
            <div className="flex items-center gap-2 text-xs text-[var(--c-muted)]">
              <span
                className="inline-block h-3 w-3 rounded-full"
                style={{ background: selectedFeature.color }}
              />
              {selectedFeature.kind === "pin" ? "Pin" : "Path"} by {selectedFeature.author}
              <button className="ml-auto" onClick={() => setSelected(null)} title="Close">
                <X size={14} />
              </button>
            </div>
            <div className="flex items-center gap-2">
              <input
                className="input flex-1 !py-1.5 text-sm"
                placeholder="Label…"
                value={label}
                autoFocus
                onChange={(e) => setLabel(e.target.value)}
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
          </div>
        )}
      </div>
    </div>
  );
}
