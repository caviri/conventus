// Resilient WebSocket connection that reconnects with backoff and forwards
// every server event into the store.
import { getToken } from "./api";
import { useStore } from "./store";

let socket: WebSocket | null = null;
let retry = 0;
let closedByUs = false;

export function connectWs() {
  const token = getToken();
  if (!token) return;
  closedByUs = false;

  const proto = location.protocol === "https:" ? "wss" : "ws";
  socket = new WebSocket(`${proto}://${location.host}/ws?token=${encodeURIComponent(token)}`);

  socket.onopen = () => {
    retry = 0;
    useStore.getState().setConnected(true);
  };

  socket.onmessage = (e) => {
    try {
      const { event, data } = JSON.parse(e.data);
      useStore.getState().handleEvent(event, data);
    } catch {
      /* ignore malformed frames */
    }
  };

  socket.onclose = () => {
    useStore.getState().setConnected(false);
    if (closedByUs) return;
    retry = Math.min(retry + 1, 6);
    setTimeout(connectWs, Math.min(1000 * 2 ** retry, 15000));
  };

  socket.onerror = () => socket?.close();
}

export function disconnectWs() {
  closedByUs = true;
  socket?.close();
  socket = null;
}

export function sendTyping(payload: Record<string, unknown>) {
  if (socket?.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({ type: "typing", ...payload }));
  }
}
