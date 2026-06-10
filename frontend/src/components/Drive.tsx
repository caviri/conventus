import { useRef, useState } from "react";
import { useStore } from "../store";
import { api } from "../api";
import { formatBytes, formatDate } from "../format";
import EmptyState from "./EmptyState";
import FilePreview from "./FilePreview";
import type { FileItem } from "../types";
import {
  HardDrive,
  Upload,
  Trash2,
  FileText,
  ImageIcon,
  Film,
  Music,
  Loader2,
} from "lucide-react";

function iconFor(mime: string) {
  if (mime.startsWith("image/")) return <ImageIcon size={18} />;
  if (mime.startsWith("video/")) return <Film size={18} />;
  if (mime.startsWith("audio/")) return <Music size={18} />;
  return <FileText size={18} />;
}

export default function Drive() {
  const files = useStore((s) => s.files);
  const user = useStore((s) => s.user);
  const refreshFiles = useStore((s) => s.refreshFiles);
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<FileItem | null>(null);

  async function upload(list: FileList | null) {
    if (!list) return;
    setBusy(true);
    try {
      for (const f of Array.from(list)) await api.upload(f);
      await refreshFiles();
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    if (!confirm("Delete this file?")) return;
    await api.del(`/api/files/${id}`);
    await refreshFiles();
  }

  const total = files.reduce((sum, f) => sum + f.size, 0);

  return (
    <div className="flex h-full flex-col">
      <header className="surface flex items-center gap-3 border-b border-[var(--c-border)] px-4 py-3 pl-14 md:pl-4">
        <HardDrive size={18} className="text-[var(--c-muted)]" />
        <div className="font-semibold">Files</div>
        <span className="text-xs text-[var(--c-muted)]">
          {files.length} files · {formatBytes(total)}
        </span>
        <button
          className="btn btn-primary ml-auto"
          onClick={() => fileRef.current?.click()}
          disabled={busy}
        >
          {busy ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />}
          Upload
        </button>
        <input
          ref={fileRef}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => upload(e.target.files)}
        />
      </header>

      <div
        className="flex-1 overflow-y-auto p-4"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          e.stopPropagation();
          upload(e.dataTransfer.files);
        }}
      >
        {files.length === 0 ? (
          <EmptyState
            title="An empty pantry"
            subtitle="Drop files here, or use the Upload button — images, audio, video and more."
          />
        ) : (
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {files.map((f) => (
              <div key={f.id} className="card group flex items-center gap-3 p-3">
                <button
                  onClick={() => setPreview(f)}
                  className="grid h-11 w-11 shrink-0 place-items-center overflow-hidden rounded-lg bg-[var(--c-elevated)]"
                  title="Preview"
                >
                  {f.mime.startsWith("image/") ? (
                    <img src={f.url} alt="" className="h-full w-full object-cover" />
                  ) : (
                    iconFor(f.mime)
                  )}
                </button>
                <button
                  onClick={() => setPreview(f)}
                  className="min-w-0 flex-1 text-left"
                  title={f.name}
                >
                  <div className="truncate text-sm font-medium">{f.name}</div>
                  <div className="truncate text-xs text-[var(--c-muted)]">
                    {formatBytes(f.size)} · {f.uploaded_by} · {formatDate(f.created_at)}
                  </div>
                </button>
                {(user?.is_admin || f.uploaded_by === user?.name) && (
                  <button
                    onClick={() => remove(f.id)}
                    className="text-[var(--c-muted)] opacity-0 transition hover:text-red-300 group-hover:opacity-100"
                  >
                    <Trash2 size={16} />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {preview && <FilePreview file={preview} onClose={() => setPreview(null)} />}
    </div>
  );
}
