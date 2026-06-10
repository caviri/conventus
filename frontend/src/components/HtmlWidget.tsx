import { useEffect, useRef, useState } from "react";
import { Code2, Maximize2, Minimize2 } from "lucide-react";

// Renders user-authored HTML in a sandboxed iframe. We deliberately withhold
// `allow-same-origin`, so the widget cannot read cookies, localStorage, or the
// parent DOM — it can run scripts only within its own throwaway origin.
export default function HtmlWidget({ html }: { html: string }) {
  const ref = useRef<HTMLIFrameElement>(null);
  const [expanded, setExpanded] = useState(false);

  const srcDoc = `<!doctype html><html><head><meta charset="utf-8">
<style>body{margin:0;padding:10px;font-family:system-ui,sans-serif;color:#111}</style>
</head><body>${html}</body></html>`;

  // Best-effort auto-height when the widget is same-origin-readable (it isn't,
  // by design), so we just keep a sane default and let users expand.
  useEffect(() => {
    if (ref.current) ref.current.srcdoc = srcDoc;
  }, [srcDoc]);

  return (
    <div className="card my-1.5 max-w-2xl overflow-hidden">
      <div className="flex items-center gap-2 border-b border-[var(--c-border)] px-3 py-1.5 text-xs text-[var(--c-muted)]">
        <Code2 size={13} />
        <span>HTML widget</span>
        <span className="ml-1 rounded bg-[var(--c-elevated)] px-1.5 py-0.5 text-[10px]">
          sandboxed
        </span>
        <button
          className="ml-auto hover:text-[var(--c-text)]"
          onClick={() => setExpanded((v) => !v)}
          title={expanded ? "Collapse" : "Expand"}
        >
          {expanded ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
        </button>
      </div>
      <iframe
        ref={ref}
        sandbox="allow-scripts allow-popups allow-forms"
        className="w-full bg-white transition-[height]"
        style={{ height: expanded ? 600 : 260 }}
        title="HTML widget"
      />
    </div>
  );
}
