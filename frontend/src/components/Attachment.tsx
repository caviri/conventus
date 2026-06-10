import type { Attachment as AttachmentType } from "../types";
import { formatBytes } from "../format";
import { useStore } from "../store";
import { FileText, Download } from "lucide-react";

export default function Attachment({ a }: { a: AttachmentType }) {
  const setLightbox = useStore((s) => s.setLightbox);

  if (a.mime.startsWith("image/")) {
    return (
      <img
        src={a.url}
        alt={a.name}
        loading="lazy"
        onClick={() => setLightbox({ url: a.url, name: a.name })}
        className="max-h-80 max-w-full cursor-zoom-in rounded-xl border border-[var(--c-border)] object-contain transition hover:brightness-105"
      />
    );
  }

  if (a.mime.startsWith("video/")) {
    return (
      <video
        src={a.url}
        controls
        playsInline
        preload="metadata"
        className="max-h-80 max-w-full rounded-xl border border-[var(--c-border)]"
      />
    );
  }

  if (a.mime.startsWith("audio/")) {
    return (
      <div className="card max-w-md p-3">
        <div className="mb-2 truncate text-sm">{a.name}</div>
        <audio src={a.url} controls className="w-full" />
      </div>
    );
  }

  return (
    <a
      href={`${a.url}?download=true`}
      className="card flex max-w-md items-center gap-3 p-3 transition hover:border-[var(--c-accent)]"
    >
      <div className="grid h-10 w-10 place-items-center rounded-lg bg-[var(--c-elevated)]">
        <FileText size={18} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">{a.name}</div>
        <div className="text-xs text-[var(--c-muted)]">{formatBytes(a.size)}</div>
      </div>
      <Download size={16} className="text-[var(--c-muted)]" />
    </a>
  );
}
