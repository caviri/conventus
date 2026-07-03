import { useEffect, useRef, useState } from "react";
import { getToken, api } from "../api";
import { useStore } from "../store";
import { ditherDuotone } from "../dither";
import BoardActions from "./BoardActions";
import {
  Radio,
  Mic,
  MicOff,
  PhoneOff,
  Loader2,
  Video,
  VideoOff,
  SlidersHorizontal,
} from "lucide-react";

// A real-time call room built on a WebRTC **mesh**: every participant opens a
// direct peer connection to every other participant, so audio and video stream
// continuously and the browser keeps each person's sound lip-synced to their
// picture for free. The server (backend/app/voice.py) only relays signaling —
// it never sees the media.
//
// Connections are set up with the "perfect negotiation" pattern so two peers can
// safely offer at the same time without glare. Adding/removing the camera just
// renegotiates the existing connection.

type PeerView = {
  name: string;
  muted: boolean;
  cam: boolean;
  stream?: MediaStream;
};

type PeerConn = {
  pc: RTCPeerConnection;
  name: string;
  polite: boolean;
  makingOffer: boolean;
  ignoreOffer: boolean;
};

// Per-client outgoing video quality. WebRTC adapts within these ceilings.
const QUALITY = {
  low: { label: "Low", bitrate: 150_000, w: 320, h: 240, fps: 15 },
  medium: { label: "Medium", bitrate: 500_000, w: 640, h: 480, fps: 24 },
  high: { label: "High", bitrate: 1_200_000, w: 1280, h: 720, fps: 30 },
} as const;
type QualityKey = keyof typeof QUALITY;

// The dithered cam — the chat's Bayer/duotone look, rendered on the sender's
// device: camera → canvas → ditherDuotone → captureStream. Peers receive the
// processed frames; the raw camera never leaves this machine.
const DITHER = { w: 240, h: 180, fps: 12, bitrate: 150_000 };

// Outgoing voice presets, applied before encoding. "Compressed" just caps the
// Opus bitrate; "Lo-fi radio" additionally routes the mic through a WebAudio
// telephone band-pass + soft clip on-device.
const VOICE = {
  full: { label: "Full", bitrate: 0 }, // 0 = browser default
  low: { label: "Compressed", bitrate: 14_000 },
  radio: { label: "Lo-fi radio", bitrate: 12_000 },
} as const;
type VoiceKey = keyof typeof VOICE;

const DEFAULT_ICE: RTCIceServer[] = [{ urls: "stun:stun.l.google.com:19302" }];
const SPEAK_RMS = 0.045; // RMS above this = "talking"

// A <video> bound to a MediaStream. Always rendered when a stream exists (even
// for camera-off peers) so their audio keeps playing; the avatar just overlays.
function MediaTile({
  stream,
  muted,
  mirror,
}: {
  stream: MediaStream;
  muted: boolean;
  mirror?: boolean;
}) {
  const ref = useRef<HTMLVideoElement | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (el.srcObject !== stream) el.srcObject = stream;
    el.play().catch(() => {});
  }, [stream]);
  return (
    <video
      ref={ref}
      autoPlay
      playsInline
      muted={muted}
      className={`h-full w-full object-cover ${mirror ? "-scale-x-100" : ""}`}
    />
  );
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
  const [peers, setPeers] = useState<Record<string, PeerView>>({});
  const [speaking, setSpeaking] = useState<Set<string>>(new Set());
  const [muted, setMuted] = useState(false);
  const [cameraOn, setCameraOn] = useState(false);
  const [quality, setQuality] = useState<QualityKey>("medium");
  const [dither, setDither] = useState(false);
  const [voice, setVoice] = useState<VoiceKey>("full");
  const [preview, setPreview] = useState<MediaStream | null>(null); // dithered self-view
  const [showSettings, setShowSettings] = useState(false);
  const [scales, setScales] = useState<Record<string, number>>({});

  const wsRef = useRef<WebSocket | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const iceRef = useRef<RTCIceServer[]>(DEFAULT_ICE);
  const selfPidRef = useRef<string>("");
  const peersRef = useRef<Map<string, PeerConn>>(new Map());
  const qualityRef = useRef<QualityKey>("medium");
  const ditherOnRef = useRef(false);
  const voiceRef = useRef<VoiceKey>("full");
  const pttRef = useRef(false); // spacebar push-to-talk currently held

  // The on-device processing pipelines (what peers actually receive).
  const ditherPipeRef = useRef<{
    video: HTMLVideoElement;
    timer: number;
    track: MediaStreamTrack;
  } | null>(null);
  const radioRef = useRef<{
    nodes: AudioNode[];
    track: MediaStreamTrack;
  } | null>(null);

  // Audio-level metering for the "who's talking" ring.
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analysersRef = useRef<
    Map<
      string,
      { analyser: AnalyserNode; data: Uint8Array<ArrayBuffer>; src: MediaStreamAudioSourceNode }
    >
  >(new Map());

  function setScale(who: string, s: number) {
    setScales((prev) => ({ ...prev, [who]: s }));
  }

  function send(obj: unknown) {
    const ws = wsRef.current;
    if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj));
  }

  function micEnabled() {
    return !!localStreamRef.current?.getAudioTracks()[0]?.enabled;
  }

  function ensureAudioCtx(): AudioContext {
    let ctx = audioCtxRef.current;
    if (!ctx) {
      const Ctx = window.AudioContext || (window as any).webkitAudioContext;
      ctx = new Ctx();
      audioCtxRef.current = ctx;
    }
    if (ctx.state === "suspended") ctx.resume().catch(() => {});
    return ctx;
  }

  // --- Audio metering ------------------------------------------------------
  function attachAnalyser(key: string, stream: MediaStream) {
    if (!stream.getAudioTracks().length || analysersRef.current.has(key)) return;
    try {
      const ctx = ensureAudioCtx();
      const src = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      src.connect(analyser); // not connected to destination — metering only
      analysersRef.current.set(key, {
        analyser,
        data: new Uint8Array(new ArrayBuffer(analyser.frequencyBinCount)),
        src,
      });
    } catch {
      /* ignore */
    }
  }

  function detachAnalyser(key: string) {
    const a = analysersRef.current.get(key);
    if (a) {
      try {
        a.src.disconnect();
      } catch {
        /* ignore */
      }
      analysersRef.current.delete(key);
    }
  }

  // --- On-device outgoing effects -------------------------------------------
  // Both pipelines transform the media *before* it reaches the encoder, so the
  // sender decides how they're perceived — peers just play what arrives.

  function startDitherPipe(raw: MediaStreamTrack): MediaStreamTrack {
    const video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    video.srcObject = new MediaStream([raw]);
    video.play().catch(() => {});
    const canvas = document.createElement("canvas");
    canvas.width = DITHER.w;
    canvas.height = DITHER.h;
    const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
    const timer = window.setInterval(() => {
      const vw = video.videoWidth;
      const vh = video.videoHeight;
      if (video.readyState < 2 || !vw || !vh) return;
      // Cover-crop the camera frame into the small canvas, then dither.
      const s = Math.max(DITHER.w / vw, DITHER.h / vh);
      ctx.drawImage(video, (DITHER.w - vw * s) / 2, (DITHER.h - vh * s) / 2, vw * s, vh * s);
      ditherDuotone(ctx, DITHER.w, DITHER.h);
    }, 1000 / DITHER.fps);
    const track = canvas.captureStream(DITHER.fps).getVideoTracks()[0];
    ditherPipeRef.current = { video, timer, track };
    return track;
  }

  function stopDitherPipe() {
    const d = ditherPipeRef.current;
    if (!d) return;
    clearInterval(d.timer);
    d.track.stop();
    d.video.srcObject = null;
    ditherPipeRef.current = null;
  }

  // Mild tanh saturation — the "driven through a small speaker" part of radio.
  function softClipCurve(drive: number): Float32Array<ArrayBuffer> {
    const n = 256;
    const curve = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const x = (i / (n - 1)) * 2 - 1;
      curve[i] = Math.tanh(drive * x) / Math.tanh(drive);
    }
    return curve;
  }

  function startRadioChain(rawTrack: MediaStreamTrack): MediaStreamTrack {
    const ctx = ensureAudioCtx();
    const src = ctx.createMediaStreamSource(new MediaStream([rawTrack]));
    const hp = ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 300; // telephone band: ~300–3400 Hz
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 3400;
    const shaper = ctx.createWaveShaper();
    shaper.curve = softClipCurve(4);
    const dest = ctx.createMediaStreamDestination();
    src.connect(hp);
    hp.connect(lp);
    lp.connect(shaper);
    shaper.connect(dest);
    const track = dest.stream.getAudioTracks()[0];
    radioRef.current = { nodes: [src, hp, lp, shaper, dest], track };
    return track;
  }

  function stopRadioChain() {
    const r = radioRef.current;
    if (!r) return;
    for (const node of r.nodes) {
      try {
        node.disconnect();
      } catch {
        /* ignore */
      }
    }
    r.track.stop();
    radioRef.current = null;
  }

  // The tracks peers should receive right now (processed when an effect is on).
  function outgoingAudioTrack(): MediaStreamTrack | undefined {
    return radioRef.current?.track ?? localStreamRef.current?.getAudioTracks()[0];
  }

  function outgoingVideoTrack(): MediaStreamTrack | undefined {
    return ditherPipeRef.current?.track ?? localStreamRef.current?.getVideoTracks()[0];
  }

  // --- Peer connections ----------------------------------------------------
  function makePeer(pid: string, peerName: string): PeerConn {
    const pc = new RTCPeerConnection({ iceServers: iceRef.current });
    const conn: PeerConn = {
      pc,
      name: peerName,
      polite: selfPidRef.current < pid, // deterministic & opposite on each side
      makingOffer: false,
      ignoreOffer: false,
    };
    peersRef.current.set(pid, conn);

    // Late joiners get whatever we're currently sending — processed tracks
    // when an on-device effect is active, raw otherwise.
    const local = localStreamRef.current;
    if (local) {
      const audio = outgoingAudioTrack();
      const video = outgoingVideoTrack();
      if (audio) pc.addTrack(audio, local);
      if (video) pc.addTrack(video, local);
    }

    pc.onnegotiationneeded = async () => {
      try {
        conn.makingOffer = true;
        await pc.setLocalDescription();
        send({ type: "signal", to: pid, data: { description: pc.localDescription } });
      } catch {
        /* ignore */
      } finally {
        conn.makingOffer = false;
      }
    };
    pc.onicecandidate = ({ candidate }) => {
      if (candidate) send({ type: "signal", to: pid, data: { candidate } });
    };
    pc.ontrack = (ev) => {
      const stream = ev.streams[0];
      if (!stream) return;
      setPeers((prev) => ({
        ...prev,
        [pid]: { ...(prev[pid] || { name: peerName, muted: false, cam: false }), stream },
      }));
      attachAnalyser(pid, stream);
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "connected") applySendParams();
      else if (pc.connectionState === "failed") {
        try {
          pc.restartIce();
        } catch {
          /* ignore */
        }
      }
    };
    return conn;
  }

  async function onSignal(from: string, data: any) {
    let conn = peersRef.current.get(from);
    if (!conn) conn = makePeer(from, from);
    const { pc } = conn;
    try {
      if (data.description) {
        const offerCollision =
          data.description.type === "offer" &&
          (conn.makingOffer || pc.signalingState !== "stable");
        conn.ignoreOffer = !conn.polite && offerCollision;
        if (conn.ignoreOffer) return;
        await pc.setRemoteDescription(data.description);
        if (data.description.type === "offer") {
          await pc.setLocalDescription();
          send({ type: "signal", to: from, data: { description: pc.localDescription } });
        }
      } else if (data.candidate) {
        try {
          await pc.addIceCandidate(data.candidate);
        } catch {
          /* ignore late/duplicate candidates */
        }
      }
    } catch {
      /* ignore */
    }
  }

  function dropPeer(pid: string) {
    const conn = peersRef.current.get(pid);
    if (conn) {
      try {
        conn.pc.close();
      } catch {
        /* ignore */
      }
      peersRef.current.delete(pid);
    }
    detachAnalyser(pid);
    setPeers((prev) => {
      if (!prev[pid]) return prev;
      const next = { ...prev };
      delete next[pid];
      return next;
    });
  }

  function connectWs() {
    const proto = location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(
      `${proto}://${location.host}/voice/${name}?token=${encodeURIComponent(getToken() || "")}`
    );
    ws.onmessage = (e) => {
      if (typeof e.data !== "string") return;
      let m: any;
      try {
        m = JSON.parse(e.data);
      } catch {
        return;
      }
      if (m.type === "welcome") {
        selfPidRef.current = m.self;
        for (const p of m.peers || []) {
          setPeers((prev) => ({
            ...prev,
            [p.pid]: { name: p.name, muted: !!p.muted, cam: !!p.cam },
          }));
          makePeer(p.pid, p.name);
        }
      } else if (m.type === "peer-join") {
        setPeers((prev) => ({ ...prev, [m.pid]: { name: m.name, muted: false, cam: false } }));
        makePeer(m.pid, m.name);
      } else if (m.type === "peer-leave") {
        dropPeer(m.pid);
      } else if (m.type === "signal") {
        onSignal(m.from, m.data);
      } else if (m.type === "state") {
        setPeers((prev) =>
          prev[m.pid]
            ? { ...prev, [m.pid]: { ...prev[m.pid], muted: !!m.muted, cam: !!m.cam } }
            : prev
        );
      }
    };
    wsRef.current = ws;
  }

  async function join() {
    if (joining || joined) return;
    setError("");
    setJoining(true);
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error("This browser can't access the mic (needs a modern browser + HTTPS).");
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      localStreamRef.current = stream;
      try {
        const cfg = await api.get<{ ice_servers?: RTCIceServer[] }>("/api/auth/config");
        if (cfg.ice_servers?.length) iceRef.current = cfg.ice_servers;
      } catch {
        /* keep STUN default */
      }
      attachAnalyser("self", stream);
      connectWs();
      setJoined(true);
    } catch (e: any) {
      setError(e?.message || "Couldn't access the microphone.");
      cleanup();
    } finally {
      setJoining(false);
    }
  }

  // --- Mic / camera controls ----------------------------------------------
  function toggleMute() {
    const track = localStreamRef.current?.getAudioTracks()[0];
    if (!track) return;
    track.enabled = !track.enabled;
    const m = !track.enabled;
    setMuted(m);
    send({ type: "state", muted: m, cam: cameraOn });
  }

  function videoConstraints(): MediaTrackConstraints {
    const q = QUALITY[qualityRef.current];
    return { width: { ideal: q.w }, height: { ideal: q.h }, frameRate: { ideal: q.fps } };
  }

  async function applySendParams() {
    const videoMax = ditherOnRef.current ? DITHER.bitrate : QUALITY[qualityRef.current].bitrate;
    const audioMax = VOICE[voiceRef.current].bitrate;
    for (const conn of peersRef.current.values()) {
      for (const sender of conn.pc.getSenders()) {
        const kind = sender.track?.kind;
        if (!kind) continue;
        const params = sender.getParameters();
        if (!params.encodings || !params.encodings.length) params.encodings = [{}];
        if (kind === "video") params.encodings[0].maxBitrate = videoMax;
        else if (audioMax) params.encodings[0].maxBitrate = audioMax;
        else delete params.encodings[0].maxBitrate;
        try {
          await sender.setParameters(params);
        } catch {
          /* ignore */
        }
      }
    }
  }

  async function startCamera() {
    if (cameraOn) return;
    try {
      const cam = await navigator.mediaDevices.getUserMedia({ video: videoConstraints() });
      const raw = cam.getVideoTracks()[0];
      if (!raw) return;
      const local = localStreamRef.current;
      if (!local) {
        raw.stop();
        return;
      }
      local.addTrack(raw);
      const sendTrack = ditherOnRef.current ? startDitherPipe(raw) : raw;
      // Add to every peer — each triggers a renegotiation automatically.
      for (const conn of peersRef.current.values()) conn.pc.addTrack(sendTrack, local);
      setPreview(ditherOnRef.current ? new MediaStream([sendTrack]) : null);
      setCameraOn(true);
      send({ type: "state", muted, cam: true });
      applySendParams();
    } catch {
      /* permission denied / no camera — stay audio-only */
    }
  }

  function stopCamera() {
    stopDitherPipe();
    setPreview(null);
    for (const conn of peersRef.current.values()) {
      for (const sender of conn.pc.getSenders()) {
        if (sender.track?.kind === "video") conn.pc.removeTrack(sender);
      }
    }
    const raw = localStreamRef.current?.getVideoTracks()[0];
    if (raw) {
      raw.stop();
      localStreamRef.current?.removeTrack(raw);
    }
    setCameraOn(false);
    send({ type: "state", muted, cam: false });
  }

  // Flip the dithered cam on/off mid-call: swap what every peer's video sender
  // is sending (replaceTrack — no renegotiation) and update the self-preview.
  async function setDitherMode(on: boolean) {
    setDither(on);
    ditherOnRef.current = on;
    const raw = localStreamRef.current?.getVideoTracks()[0];
    if (!cameraOn || !raw) return; // applies when the camera next starts
    const next = on ? startDitherPipe(raw) : raw;
    if (!on) stopDitherPipe();
    for (const conn of peersRef.current.values()) {
      for (const sender of conn.pc.getSenders()) {
        if (sender.track?.kind !== "video") continue;
        try {
          await sender.replaceTrack(next);
        } catch {
          /* ignore */
        }
      }
    }
    setPreview(on ? new MediaStream([next]) : null);
    applySendParams();
  }

  function cleanup() {
    for (const conn of peersRef.current.values()) {
      try {
        conn.pc.close();
      } catch {
        /* ignore */
      }
    }
    peersRef.current.clear();
    stopDitherPipe();
    stopRadioChain();
    for (const key of [...analysersRef.current.keys()]) detachAnalyser(key);
    audioCtxRef.current?.close().catch(() => {});
    audioCtxRef.current = null;
    localStreamRef.current?.getTracks().forEach((t) => t.stop());
    localStreamRef.current = null;
    wsRef.current?.close();
    wsRef.current = null;
  }

  function leave() {
    cleanup();
    setJoined(false);
    setPeers({});
    setSpeaking(new Set());
    setMuted(false);
    setCameraOn(false);
    setPreview(null);
    setScales({});
    pttRef.current = false;
  }

  // Keep the live quality knob in sync; re-apply to an active camera.
  useEffect(() => {
    qualityRef.current = quality;
    if (cameraOn) {
      localStreamRef.current?.getVideoTracks()[0]?.applyConstraints(videoConstraints()).catch(() => {});
      applySendParams();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quality]);

  // Voice preset: swap the outgoing audio track between the raw mic and the
  // on-device radio chain, and cap the Opus bitrate. Mute/PTT keep working —
  // they toggle the raw mic track, which feeds the chain.
  useEffect(() => {
    voiceRef.current = voice;
    if (!joined) return;
    (async () => {
      const raw = localStreamRef.current?.getAudioTracks()[0];
      if (!raw) return;
      let next: MediaStreamTrack = raw;
      if (voice === "radio") {
        next = radioRef.current?.track ?? startRadioChain(raw);
      } else {
        stopRadioChain();
      }
      for (const conn of peersRef.current.values()) {
        for (const sender of conn.pc.getSenders()) {
          if (sender.track?.kind !== "audio") continue;
          try {
            await sender.replaceTrack(next);
          } catch {
            /* ignore */
          }
        }
      }
      applySendParams();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voice, joined]);

  // Audio-level loop → "talking" rings.
  useEffect(() => {
    if (!joined) return;
    let raf = 0;
    const tick = () => {
      const next = new Set<string>();
      for (const [key, { analyser, data }] of analysersRef.current) {
        analyser.getByteTimeDomainData(data);
        let sum = 0;
        for (let i = 0; i < data.length; i++) {
          const v = (data[i] - 128) / 128;
          sum += v * v;
        }
        const rms = Math.sqrt(sum / data.length);
        if (rms <= SPEAK_RMS) continue;
        if (key === "self") {
          if (micEnabled()) next.add("self");
        } else next.add(key);
      }
      setSpeaking((prev) => {
        if (prev.size === next.size && [...prev].every((k) => next.has(k))) return prev;
        return next;
      });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [joined]);

  // Spacebar = hold-to-talk while muted (temporary unmute). Familiar muscle memory.
  useEffect(() => {
    if (!joined) return;
    const onDown = (e: KeyboardEvent) => {
      if (e.code !== "Space" || e.repeat) return;
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (!muted) return; // only acts as PTT when you're muted
      e.preventDefault();
      const track = localStreamRef.current?.getAudioTracks()[0];
      if (!track) return;
      pttRef.current = true;
      track.enabled = true;
      send({ type: "state", muted: false, cam: cameraOn });
    };
    const onUp = (e: KeyboardEvent) => {
      if (e.code !== "Space" || !pttRef.current) return;
      e.preventDefault();
      pttRef.current = false;
      const track = localStreamRef.current?.getAudioTracks()[0];
      if (track) track.enabled = false;
      send({ type: "state", muted: true, cam: cameraOn });
    };
    window.addEventListener("keydown", onDown);
    window.addEventListener("keyup", onUp);
    return () => {
      window.removeEventListener("keydown", onDown);
      window.removeEventListener("keyup", onUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [joined, muted, cameraOn]);

  // Tear down on unmount / when switching boards.
  useEffect(() => () => cleanup(), []);

  const selfName = user?.name || "You";
  const tiles: {
    key: string;
    label: string;
    me: boolean;
    stream?: MediaStream;
    cam: boolean;
    muted: boolean;
    talking: boolean;
  }[] = [
    {
      key: "self",
      label: `${selfName} (you)`,
      me: true,
      // With the dithered cam on, preview what peers actually receive.
      stream: preview || localStreamRef.current || undefined,
      cam: cameraOn,
      muted,
      talking: speaking.has("self"),
    },
    ...Object.entries(peers).map(([pid, p]) => ({
      key: pid,
      label: p.name,
      me: false,
      stream: p.stream,
      cam: p.cam,
      muted: p.muted,
      talking: speaking.has(pid),
    })),
  ];

  return (
    <div className="flex h-full flex-col">
      <header className="surface relative flex items-center gap-3 border-b border-[var(--c-border)] px-4 py-3 pl-14 md:pl-4">
        <Radio size={18} className="text-[var(--c-muted)]" />
        <div className="font-semibold">{title}</div>
        <BoardActions id={id} name={title} />
        {joined && (
          <div className="ml-auto flex items-center gap-2">
            <button
              className={`btn !py-1.5 text-xs ${muted ? "text-red-300" : ""}`}
              onClick={toggleMute}
              title={muted ? "Unmute" : "Mute"}
            >
              {muted ? <MicOff size={14} /> : <Mic size={14} />}
              <span className="hidden sm:inline">{muted ? "Unmute" : "Mute"}</span>
            </button>
            <button
              className={`btn !py-1.5 text-xs ${cameraOn ? "btn-primary" : ""}`}
              onClick={() => (cameraOn ? stopCamera() : startCamera())}
            >
              {cameraOn ? <VideoOff size={14} /> : <Video size={14} />}
              <span className="hidden sm:inline">{cameraOn ? "Stop camera" : "Start camera"}</span>
            </button>
            <button
              className={`btn !py-1.5 text-xs ${showSettings ? "btn-primary" : ""}`}
              onClick={() => setShowSettings((v) => !v)}
              title="Call settings"
            >
              <SlidersHorizontal size={14} />
            </button>
            <button className="btn !py-1.5 text-xs text-red-300" onClick={leave}>
              <PhoneOff size={14} /> Leave
            </button>
          </div>
        )}
        {joined && showSettings && (
          <>
            <div className="fixed inset-0 z-30" onClick={() => setShowSettings(false)} />
            <div className="card absolute right-3 top-full z-40 mt-1 flex w-72 max-w-[calc(100vw-1.5rem)] flex-col gap-3 p-3 text-sm shadow-2xl fade-in">
              <p className="text-xs text-[var(--c-muted)]">
                How the room sees and hears <em>you</em> — applied on your device,
                before anything is sent.
              </p>
              <label className="flex items-center justify-between gap-3">
                <span>Video quality</span>
                <select
                  className="input !w-auto !py-1 text-xs"
                  value={quality}
                  onChange={(e) => setQuality(e.target.value as QualityKey)}
                >
                  {(Object.keys(QUALITY) as QualityKey[]).map((k) => (
                    <option key={k} value={k}>
                      {QUALITY[k].label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex cursor-pointer items-center justify-between gap-3">
                <span>
                  Dithered cam{" "}
                  <span className="text-xs text-[var(--c-muted)]">(duotone lo-fi)</span>
                </span>
                <input
                  type="checkbox"
                  checked={dither}
                  onChange={(e) => setDitherMode(e.target.checked)}
                />
              </label>
              <label className="flex items-center justify-between gap-3">
                <span>Voice</span>
                <select
                  className="input !w-auto !py-1 text-xs"
                  value={voice}
                  onChange={(e) => setVoice(e.target.value as VoiceKey)}
                >
                  {(Object.keys(VOICE) as VoiceKey[]).map((k) => (
                    <option key={k} value={k}>
                      {VOICE[k].label}
                    </option>
                  ))}
                </select>
              </label>
              <p className="mt-1 border-t border-[var(--c-border)] pt-2 text-xs text-[var(--c-muted)]">
                Mics stay open — hit <span className="text-[var(--c-text)]">Mute</span> for privacy,
                or hold <span className="text-[var(--c-text)]">Space</span> to talk while muted.
              </p>
            </div>
          </>
        )}
      </header>

      <div className="flex min-h-0 flex-1 flex-col p-4">
        {!joined ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
            <Radio size={40} className="text-[var(--c-accent)]" />
            <h2 className="font-display text-xl font-semibold">{title}</h2>
            <p className="max-w-sm text-sm text-[var(--c-muted)]">
              A live call room. Everyone's mic stays open and audio plays in sync with their
              video — peer-to-peer, so it never touches the server. Switch your camera on or off
              anytime, and resize any tile.
            </p>
            <button className="btn btn-primary" onClick={join} disabled={joining}>
              {joining ? <Loader2 size={16} className="animate-spin" /> : <Mic size={16} />}
              {joining ? "Joining…" : "Join call"}
            </button>
            {error && <p className="text-sm text-red-300">{error}</p>}
          </div>
        ) : (
          <div className="flex flex-1 flex-wrap content-center items-start justify-center gap-3 overflow-y-auto p-2">
            {tiles.map((t) => {
              const scale = scales[t.key] || 1;
              const showVideo = t.cam && !!t.stream;
              return (
                <div
                  key={t.key}
                  className={`group flex flex-col items-center gap-1.5 rounded-xl border px-3 py-3 transition ${
                    t.talking
                      ? "border-[var(--c-accent)] bg-[var(--c-accent-soft)]"
                      : "border-[var(--c-border)]"
                  }`}
                >
                  <div
                    className={`relative overflow-hidden rounded-lg bg-[var(--c-elevated)] transition ${
                      t.talking ? "ring-2 ring-[var(--c-accent)]" : ""
                    }`}
                    style={{ width: 128 * scale, height: 96 * scale }}
                  >
                    {/* Stream is always mounted (audio keeps playing); avatar overlays when camera is off. */}
                    {t.stream && <MediaTile stream={t.stream} muted={t.me} mirror={t.me} />}
                    {!showVideo && (
                      <div className="absolute inset-0 grid place-items-center">
                        <div
                          className="grid place-items-center rounded-full font-semibold text-white"
                          style={{
                            width: 48 * Math.min(scale, 2),
                            height: 48 * Math.min(scale, 2),
                            fontSize: Math.round(48 * Math.min(scale, 2) * 0.4),
                            background: "#64748b",
                          }}
                        >
                          {t.label.charAt(0).toUpperCase()}
                        </div>
                      </div>
                    )}
                  </div>
                  <span className="flex items-center gap-1 text-xs">
                    {t.muted ? (
                      <MicOff size={12} className="text-red-300" />
                    ) : (
                      <Mic
                        size={12}
                        className={t.talking ? "text-[var(--c-accent)]" : "text-[var(--c-muted)] opacity-50"}
                      />
                    )}
                    {t.label}
                  </span>
                  {/* Per-tile size — revealed on hover */}
                  <div className="flex gap-1 opacity-0 transition group-hover:opacity-100">
                    {[1, 1.5, 2, 3, 5].map((s) => (
                      <button
                        key={s}
                        onClick={() => setScale(t.key, s)}
                        className={`rounded px-1.5 py-0.5 text-[10px] ${
                          scale === s
                            ? "bg-[var(--c-accent)] text-white"
                            : "bg-[var(--c-elevated)] text-[var(--c-muted)] hover:text-[var(--c-text)]"
                        }`}
                      >
                        {s}×
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
