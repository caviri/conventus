// Client-side Yjs provider that talks to the Conventus collab relay.
// Frames are [type byte] + payload: 0 = document update, 1 = awareness.
import * as Y from "yjs";
import {
  Awareness,
  applyAwarenessUpdate,
  encodeAwarenessUpdate,
  removeAwarenessStates,
} from "y-protocols/awareness";
import { getToken } from "./api";

const DOC_UPDATE = 0;
const AWARENESS = 1;
const SNAPSHOT = 2;
const REQUEST_SNAPSHOT = 3;

export interface Collab {
  doc: Y.Doc;
  awareness: Awareness;
  onStatus: (cb: (connected: boolean) => void) => void;
  destroy: () => void;
}

export function createCollab(name: string): Collab {
  const doc = new Y.Doc();
  const awareness = new Awareness(doc);
  let ws: WebSocket | null = null;
  let closed = false;
  let statusCb: (c: boolean) => void = () => {};

  function frame(type: number, payload: Uint8Array) {
    const out = new Uint8Array(payload.length + 1);
    out[0] = type;
    out.set(payload, 1);
    return out;
  }

  function send(type: number, payload: Uint8Array) {
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(frame(type, payload));
  }

  function connect() {
    const proto = location.protocol === "https:" ? "wss" : "ws";
    ws = new WebSocket(
      `${proto}://${location.host}/collab/${name}?token=${encodeURIComponent(getToken() || "")}`
    );
    ws.binaryType = "arraybuffer";

    ws.onopen = () => {
      statusCb(true);
      // Push our current document state and presence to the relay/peers.
      send(DOC_UPDATE, Y.encodeStateAsUpdate(doc));
      send(
        AWARENESS,
        encodeAwarenessUpdate(awareness, [doc.clientID])
      );
    };
    ws.onmessage = (e) => {
      const buf = new Uint8Array(e.data as ArrayBuffer);
      const type = buf[0];
      const payload = buf.subarray(1);
      if (type === DOC_UPDATE) Y.applyUpdate(doc, payload, "remote");
      else if (type === AWARENESS) applyAwarenessUpdate(awareness, payload, "remote");
      else if (type === REQUEST_SNAPSHOT) {
        // Server is compacting the log — hand it our full merged state.
        send(SNAPSHOT, Y.encodeStateAsUpdate(doc));
      }
    };
    ws.onclose = () => {
      statusCb(false);
      if (!closed) setTimeout(connect, 1500);
    };
    ws.onerror = () => ws?.close();
  }

  // Local document changes (origin !== "remote") are sent to the relay.
  doc.on("update", (update: Uint8Array, origin: unknown) => {
    if (origin === "remote") return;
    send(DOC_UPDATE, update);
  });

  awareness.on(
    "update",
    ({ added, updated, removed }: { added: number[]; updated: number[]; removed: number[] }) => {
      const changed = [...added, ...updated, ...removed];
      send(AWARENESS, encodeAwarenessUpdate(awareness, changed));
    }
  );

  connect();

  return {
    doc,
    awareness,
    onStatus: (cb) => {
      statusCb = cb;
    },
    destroy: () => {
      closed = true;
      removeAwarenessStates(awareness, [doc.clientID], "local");
      ws?.close();
      doc.destroy();
    },
  };
}
