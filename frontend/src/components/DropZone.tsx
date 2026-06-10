import { useEffect, useRef, useState } from "react";
import { useStore } from "../store";
import { api } from "../api";
import { UploadCloud } from "lucide-react";

// A full-window drop target: drag files anywhere over the app and drop to share
// them in the current channel/DM. Dropping directly on the composer stages them
// instead (that handler calls stopPropagation), and the Drive handles its own.
export default function DropZone() {
  const view = useStore((s) => s.view);
  const channels = useStore((s) => s.channels);
  const [active, setActive] = useState(false);
  const counter = useRef(0);

  const endpoint =
    view.type === "channel"
      ? `/api/channels/${view.id}/messages`
      : view.type === "dm"
      ? `/api/dms/${(view as any).id}/messages`
      : null;

  const where =
    view.type === "channel"
      ? `#${channels.find((c) => c.id === view.id)?.name ?? "channel"}`
      : view.type === "dm"
      ? "this conversation"
      : "";

  useEffect(() => {
    const hasFiles = (e: DragEvent) =>
      !!e.dataTransfer && Array.from(e.dataTransfer.types || []).includes("Files");

    const onEnter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      counter.current += 1;
      setActive(true);
    };
    const onOver = (e: DragEvent) => {
      if (hasFiles(e)) e.preventDefault();
    };
    const onLeave = () => {
      counter.current -= 1;
      if (counter.current <= 0) {
        counter.current = 0;
        setActive(false);
      }
    };
    const onDrop = (e: DragEvent) => {
      counter.current = 0;
      setActive(false);
      if (!hasFiles(e) || !endpoint) return;
      e.preventDefault();
      const files = e.dataTransfer?.files;
      if (files && files.length) void upload(files);
    };

    window.addEventListener("dragenter", onEnter);
    window.addEventListener("dragover", onOver);
    window.addEventListener("dragleave", onLeave);
    window.addEventListener("drop", onDrop);
    return () => {
      window.removeEventListener("dragenter", onEnter);
      window.removeEventListener("dragover", onOver);
      window.removeEventListener("dragleave", onLeave);
      window.removeEventListener("drop", onDrop);
    };
  }, [endpoint]);

  async function upload(files: FileList) {
    if (!endpoint) return;
    const ids: string[] = [];
    for (const f of Array.from(files)) {
      try {
        const uploaded = await api.upload(f);
        ids.push(uploaded.id);
      } catch {
        /* skip */
      }
    }
    if (ids.length) await api.post(endpoint, { content: "", attachments: ids });
  }

  if (!active || !endpoint) return null;

  return (
    <div className="pointer-events-none fixed inset-0 z-[55] flex items-center justify-center bg-[var(--c-bg)]/70 backdrop-blur-sm fade-in">
      <div className="card flex flex-col items-center gap-3 border-2 border-dashed border-[var(--c-accent)] px-12 py-10 text-center">
        <UploadCloud size={40} className="text-[var(--c-accent)]" />
        <div className="font-display text-lg">Drop to share in {where}</div>
        <div className="text-sm text-[var(--c-muted)]">
          Images, audio, video and files — released to the room.
        </div>
      </div>
    </div>
  );
}
