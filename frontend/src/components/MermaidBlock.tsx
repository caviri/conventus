import { useEffect, useState } from "react";

// A ```mermaid fenced block rendered to SVG. The mermaid library is heavy, so
// it loads lazily the first time a diagram is actually on screen; on failure
// the raw source shows as a plain code block instead of erroring out.

let mermaidPromise: Promise<any> | null = null;
function loadMermaid() {
  if (!mermaidPromise) {
    mermaidPromise = import("mermaid").then((mod) => {
      const mermaid = mod.default;
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: "strict",
        theme: document.documentElement.dataset.theme === "light" ? "neutral" : "dark",
      });
      return mermaid;
    });
  }
  return mermaidPromise;
}

let seq = 0;

export default function MermaidBlock({ code }: { code: string }) {
  const [svg, setSvg] = useState("");
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    setSvg("");
    setFailed(false);
    loadMermaid()
      .then((mermaid) => mermaid.render(`conventus-mmd-${++seq}`, code))
      .then((r: { svg: string }) => alive && setSvg(r.svg))
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, [code]);

  if (failed) {
    return (
      <pre className="my-2 overflow-x-auto rounded-lg border border-[var(--c-border)] bg-[var(--c-surface-2)] p-3 text-xs">
        {code}
      </pre>
    );
  }
  if (!svg) {
    return (
      <div className="my-2 rounded-lg border border-[var(--c-border)] px-3 py-2 text-xs text-[var(--c-muted)]">
        Rendering diagram…
      </div>
    );
  }
  return (
    <div
      className="md-mermaid my-2 overflow-x-auto rounded-lg bg-white/90 p-2 [&_svg]:mx-auto [&_svg]:max-w-full"
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
