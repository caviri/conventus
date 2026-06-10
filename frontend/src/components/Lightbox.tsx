import { useEffect, useState } from "react";
import { useStore } from "../store";
import { X, Download } from "lucide-react";

// Full-screen image/GIF viewer. Click the image to toggle zoom, click the
// backdrop or press Escape to close.
export default function Lightbox() {
  const lb = useStore((s) => s.lightbox);
  const setLightbox = useStore((s) => s.setLightbox);
  const [zoom, setZoom] = useState(false);

  useEffect(() => {
    setZoom(false);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setLightbox(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [lb, setLightbox]);

  if (!lb) return null;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center overflow-auto bg-black/85 p-4 fade-in"
      onClick={() => setLightbox(null)}
    >
      <div className="absolute right-4 top-4 z-10 flex gap-2">
        <a
          href={`${lb.url}?download=true`}
          onClick={(e) => e.stopPropagation()}
          className="btn !p-2"
          title="Download"
        >
          <Download size={18} />
        </a>
        <button className="btn !p-2" onClick={() => setLightbox(null)} title="Close (Esc)">
          <X size={18} />
        </button>
      </div>
      <img
        src={lb.url}
        alt={lb.name || ""}
        onClick={(e) => {
          e.stopPropagation();
          setZoom((z) => !z);
        }}
        className="rounded-xl object-contain transition-transform duration-200"
        style={{
          maxHeight: zoom ? "none" : "90vh",
          maxWidth: zoom ? "none" : "92vw",
          cursor: zoom ? "zoom-out" : "zoom-in",
          transform: zoom ? "scale(1.0)" : "none",
        }}
      />
    </div>
  );
}
