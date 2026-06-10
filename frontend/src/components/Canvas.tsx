import { useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "../store";
import { createCollab } from "../collab";
import { caretCoords } from "../caret";
import { renderContent, splitSegments } from "../format";
import Markdown from "./Markdown";
import BoardActions from "./BoardActions";
import { FileText, Download, FileDown, FileType } from "lucide-react";

function escapeHtml(s: string): string {
  return s.replace(
    /[&<>"]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] as string
  );
}

function slug(s: string): string {
  return s.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "document";
}

// Self-contained printable HTML for the "Download PDF" path (the browser's
// print dialog handles the actual PDF export).
function buildPrintHtml(title: string, md: string): string {
  const body = splitSegments(md)
    .map((seg) =>
      seg.type === "code" || seg.type === "html"
        ? `<pre class="code"><code>${escapeHtml(seg.value)}</code></pre>`
        : renderContent(seg.value)
    )
    .join("\n");
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(
    title
  )}</title><style>
    *{box-sizing:border-box}
    body{font:15px/1.6 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;color:#1e293b;max-width:46rem;margin:2.5rem auto;padding:0 1.5rem}
    h1.doc-title{font-size:1.9rem;margin:0 0 1.2rem;border-bottom:2px solid #e2e8f0;padding-bottom:.5rem}
    .md-h{font-weight:700;line-height:1.25;margin:1.2em 0 .4em}
    h1.md-h{font-size:1.5rem}h2.md-h{font-size:1.25rem}h3.md-h{font-size:1.1rem}
    blockquote{border-left:3px solid #94a3b8;padding-left:.8rem;margin:.5rem 0;color:#475569}
    li{margin-left:1.4em;list-style:disc}
    code{background:#f1f5f9;border-radius:4px;padding:0 .3em;font-family:ui-monospace,monospace;font-size:.9em}
    pre.code{background:#0f172a;color:#e2e8f0;border-radius:10px;padding:.9rem 1rem;overflow:auto;font-size:.85em}
    pre.code code{background:none;padding:0;color:inherit}
    img.md-media{max-width:100%;border-radius:8px;margin:.5rem 0}
    .md-table{border-collapse:collapse;margin:.6rem 0;font-size:.92em}
    .md-table th,.md-table td{border:1px solid #cbd5e1;padding:.3rem .6rem;text-align:left}
    .md-table th{background:#f1f5f9}
    a{color:#0e7490}hr{border:0;border-top:1px solid #e2e8f0;margin:1rem 0}
    @media print{body{margin:0;max-width:none}}
  </style></head><body><h1 class="doc-title">${escapeHtml(title)}</h1>${body}</body></html>`;
}

// Minimal text-diff so concurrent edits don't clobber each other: find the
// common prefix/suffix and only apply the changed span to the shared Y.Text.
function diff(oldStr: string, newStr: string) {
  let start = 0;
  const min = Math.min(oldStr.length, newStr.length);
  while (start < min && oldStr[start] === newStr[start]) start++;
  let oldEnd = oldStr.length;
  let newEnd = newStr.length;
  while (oldEnd > start && newEnd > start && oldStr[oldEnd - 1] === newStr[newEnd - 1]) {
    oldEnd--;
    newEnd--;
  }
  return { start, remove: oldEnd - start, insert: newStr.slice(start, newEnd) };
}

interface RemoteCursor {
  id: number;
  name: string;
  color: string;
  index: number;
}

const PLACEHOLDER = `# Shared canvas

A collaborative **markdown** scratchpad — everyone in the room edits this in
real time, and you can see each other's cursors. Try a code block:

\`\`\`python
def hello(name):
    return f"hi {name}"
\`\`\`

Drop in images with \`![alt](url)\`, or an \`\`\`html widget. Changes sync live.`;

export default function Canvas({
  id,
  name,
  title,
}: {
  id: number;
  name: string;
  title: string;
}) {
  const user = useStore((s) => s.user);
  const collab = useMemo(() => createCollab(name), [name]);
  const ytext = useMemo(() => collab.doc.getText("content"), [collab]);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const [value, setValue] = useState(() => ytext.toString());
  const [peers, setPeers] = useState<{ name: string; color: string }[]>([]);
  const [cursors, setCursors] = useState<RemoteCursor[]>([]);
  const [dlOpen, setDlOpen] = useState(false);
  const [, forceTick] = useState(0);

  function downloadMarkdown() {
    setDlOpen(false);
    const blob = new Blob([value || ""], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${slug(title)}.md`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function downloadPdf() {
    setDlOpen(false);
    const w = window.open("", "_blank");
    if (!w) return;
    w.document.write(buildPrintHtml(title, value || ""));
    w.document.close();
    w.focus();
    // Give images/layout a moment before invoking the print → "Save as PDF".
    setTimeout(() => w.print(), 350);
  }

  function publishCursor() {
    const ta = taRef.current;
    if (ta) collab.awareness.setLocalStateField("cursor", { index: ta.selectionStart });
  }

  useEffect(() => {
    collab.awareness.setLocalStateField("user", {
      name: user?.name,
      color: user?.color,
    });

    const updateAwareness = () => {
      const others: { name: string; color: string }[] = [];
      const remote: RemoteCursor[] = [];
      collab.awareness.getStates().forEach((s: any, id: number) => {
        if (id === collab.doc.clientID || !s.user) return;
        others.push(s.user);
        if (s.cursor && typeof s.cursor.index === "number") {
          remote.push({ id, name: s.user.name, color: s.user.color, index: s.cursor.index });
        }
      });
      setPeers(others);
      setCursors(remote);
    };
    collab.awareness.on("change", updateAwareness);
    updateAwareness();

    const observer = (_event: unknown, tr: { origin: unknown }) => {
      if (tr.origin === "local") return;
      const ta = taRef.current;
      const next = ytext.toString();
      if (ta && document.activeElement === ta) {
        const pos = ta.selectionStart;
        setValue(next);
        requestAnimationFrame(() => {
          try {
            ta.selectionStart = ta.selectionEnd = Math.min(pos, next.length);
          } catch {
            /* ignore */
          }
        });
      } else {
        setValue(next);
      }
    };
    ytext.observe(observer);
    setValue(ytext.toString());

    return () => {
      ytext.unobserve(observer);
      collab.awareness.off("change", updateAwareness);
      collab.destroy();
    };
  }, [collab, ytext, user]);

  function onChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const next = e.target.value;
    const cur = ytext.toString();
    setValue(next);
    if (next !== cur) {
      const d = diff(cur, next);
      collab.doc.transact(() => {
        if (d.remove) ytext.delete(d.start, d.remove);
        if (d.insert) ytext.insert(d.start, d.insert);
      }, "local");
    }
    publishCursor();
  }

  const ta = taRef.current;
  const preview = value.trim() ? value : PLACEHOLDER;

  return (
    <div className="flex h-full flex-col">
      <header className="surface flex items-center gap-3 border-b border-[var(--c-border)] px-4 py-3 pl-14 md:pl-4">
        <FileText size={18} className="text-[var(--c-muted)]" />
        <div className="font-semibold">{title}</div>
        <BoardActions id={id} name={title} />

        <div className="relative ml-auto">
          <button
            className="grid h-7 w-7 place-items-center rounded text-[var(--c-muted)] hover:bg-[var(--c-elevated)] hover:text-[var(--c-text)]"
            onClick={() => setDlOpen((v) => !v)}
            title="Download document"
          >
            <Download size={15} />
          </button>
          {dlOpen && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setDlOpen(false)} />
              <div className="card absolute right-0 top-8 z-20 w-44 overflow-hidden p-1 text-sm shadow-2xl fade-in">
                <button
                  className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-[var(--c-elevated)]"
                  onClick={downloadMarkdown}
                >
                  <FileDown size={15} /> Download .md
                </button>
                <button
                  className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-[var(--c-elevated)]"
                  onClick={downloadPdf}
                >
                  <FileType size={15} /> Download PDF
                </button>
              </div>
            </>
          )}
        </div>

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
      </header>

      <div className="flex min-h-0 flex-1 flex-col md:grid md:grid-cols-2">
        <div className="relative min-h-0 flex-1 border-b border-[var(--c-border)] md:flex-none md:border-b-0 md:border-r">
          <textarea
            ref={taRef}
            value={value}
            onChange={onChange}
            onSelect={publishCursor}
            onScroll={() => forceTick((t) => t + 1)}
            spellCheck={false}
            placeholder={PLACEHOLDER}
            className="h-full w-full resize-none bg-transparent p-4 font-mono text-sm outline-none"
          />
          {/* Remote carets overlay */}
          <div className="pointer-events-none absolute inset-0 overflow-hidden">
            {ta &&
              cursors.map((c) => {
                const at = caretCoords(ta, Math.min(c.index, value.length));
                const top = at.top - ta.scrollTop;
                const left = at.left - ta.scrollLeft;
                if (top < -20 || top > ta.clientHeight) return null;
                return (
                  <div key={c.id} style={{ position: "absolute", left, top }}>
                    <div style={{ width: 2, height: at.height, background: c.color }} />
                    <div
                      className="absolute whitespace-nowrap rounded px-1 text-[10px] font-medium text-white"
                      style={{ background: c.color, top: -14, left: 0 }}
                    >
                      {c.name}
                    </div>
                  </div>
                );
              })}
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-4 md:h-full md:flex-none">
          <Markdown content={preview} />
        </div>
      </div>
    </div>
  );
}
