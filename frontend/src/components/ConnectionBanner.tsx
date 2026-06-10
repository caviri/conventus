import { useEffect, useState } from "react";
import { useStore } from "../store";
import { WifiOff, Loader2 } from "lucide-react";

// A small, debounced toast shown when the device goes offline or the realtime
// connection drops. The WebSocket reconnects on its own; this just tells the
// user what's happening (the sidebar's status dot is hidden on mobile).
export default function ConnectionBanner() {
  const connected = useStore((s) => s.connected);
  const [online, setOnline] = useState(
    typeof navigator === "undefined" ? true : navigator.onLine
  );
  const [show, setShow] = useState(false);

  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);

  // Only surface it after a short delay, so brief blips don't flash.
  useEffect(() => {
    const down = !connected || !online;
    if (!down) {
      setShow(false);
      return;
    }
    const t = setTimeout(() => setShow(true), 1800);
    return () => clearTimeout(t);
  }, [connected, online]);

  if (!show) return null;
  const offline = !online;

  return (
    <div className="fixed left-1/2 top-3 z-[70] -translate-x-1/2 fade-in">
      <div className="card flex items-center gap-2 px-3 py-1.5 text-xs shadow-lg">
        {offline ? (
          <WifiOff size={14} className="text-amber-400" />
        ) : (
          <Loader2 size={14} className="animate-spin text-amber-400" />
        )}
        {offline ? "You're offline" : "Reconnecting…"}
      </div>
    </div>
  );
}
