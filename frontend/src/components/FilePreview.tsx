import { useEffect, useState } from "react";
import { renderContent } from "../format";
import { formatBytes, formatDate } from "../format";
import type { FileItem } from "../types";
import { Download, X, Loader2, FileText } from "lucide-react";

type Kind = "image" | "video" | "audio" | "pdf" | "markdown" | "text" | "other";

function kindOf(f: FileItem): Kind {
  const mime = f.mime || "";
  const name = f.name.toLowerCase();
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "audio";
  if (mime === "application/pdf" || name.endsWith(".pdf")) return "pdf";
  if (name.endsWith(".md") || name.endsWith(".markdown") || mime === "text/markdown")
    return "markdown";
  if (
    mime.startsWith("text/") ||
    /\.(txt|csv|json|ya?ml|log|ini|toml|js|ts|tsx|jsx|py|css|html?|xml|sh|rs|go|java|c|cpp|h)$/.test(
      name
    )
  )
    return "text";
  return "other";
}

// In-app viewer for Drive files: images, markdown, plain text, PDFs, audio and
// video render inline; anything else offers a download.
export default function FilePreview({
  file,
  onClose,
}: {
  file: FileItem;
  onClose: () => void;
}) {
  const kind = kindOf(file);
  const [text, setText] = useState<string | null>(null);
  const [loading, setLoading] = useState(kind === "markdown" || kind === "text");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    if (kind !== "markdown" && kind !== "text") return;
    let alive = true;
    setLoading(true);
    fetch(file.url)
      .then((r) => r.text())
      .then((t) => alive && setText(t.slice(0, 200_000)))
      .catch(() => alive && setText("Could not load this file."))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [file.url, kind]);

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 p-4 fade-in"
      onClick={onClose}
    >
      <div
        className="card flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center gap-3 border-b border-[var(--c-border)] px-4 py-3">
          <FileText size={18} className="shrink-0 text-[var(--c-muted)]" />
          <div className="min-w-0">
            <div className="truncate text-sm font-medium" title={file.name}>
              {file.name}
            </div>
            <div className="truncate text-xs text-[var(--c-muted)]">
              {formatBytes(file.size)} · {file.uploaded_by} · {formatDate(file.created_at)}
            </div>
          </div>
          <a
            href={`${file.url}?download=true`}
            className="btn ml-auto !p-2"
            title="Download"
            onClick={(e) => e.stopPropagation()}
          >
            <Download size={18} />
          </a>
          <button className="btn !p-2" onClick={onClose} title="Close (Esc)">
            <X size={18} />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-auto bg-[var(--c-bg)] p-4">
          {loading ? (
            <div className="flex h-40 items-center justify-center text-[var(--c-muted)]">
              <Loader2 size={20} className="animate-spin" />
            </div>
          ) : kind === "image" ? (
            <img
              src={file.url}
              alt={file.name}
              className="mx-auto max-h-[75vh] rounded-lg object-contain"
            />
          ) : kind === "video" ? (
            <video src={file.url} controls className="mx-auto max-h-[75vh] w-full rounded-lg" />
          ) : kind === "audio" ? (
            <audio src={file.url} controls className="w-full" />
          ) : kind === "pdf" ? (
            <iframe
              src={file.url}
              title={file.name}
              className="h-[75vh] w-full rounded-lg border border-[var(--c-border)] bg-white"
            />
          ) : kind === "markdown" ? (
            <div
              className="msg-content mx-auto max-w-2xl text-sm leading-relaxed"
              dangerouslySetInnerHTML={{ __html: renderContent(text || "") }}
            />
          ) : kind === "text" ? (
            <pre className="whitespace-pre-wrap break-words rounded-lg bg-[var(--c-surface)] p-3 text-xs leading-relaxed">
              {text}
            </pre>
          ) : (
            <div className="flex h-40 flex-col items-center justify-center gap-3 text-[var(--c-muted)]">
              <p className="text-sm">No preview available for this file type.</p>
              <a href={`${file.url}?download=true`} className="btn btn-primary">
                <Download size={16} /> Download
              </a>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
