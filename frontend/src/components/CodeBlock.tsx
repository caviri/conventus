import { useMemo, useState } from "react";
import hljs from "highlight.js/lib/common";
import { Check, Copy } from "lucide-react";

// A fenced code block with language detection, syntax highlighting, and a
// copy button. The dark code surface is fixed across light/dark themes.
export default function CodeBlock({
  code,
  lang,
}: {
  code: string;
  lang?: string;
}) {
  const [copied, setCopied] = useState(false);

  const { html, language } = useMemo(() => {
    try {
      if (lang && hljs.getLanguage(lang)) {
        return {
          html: hljs.highlight(code, { language: lang }).value,
          language: lang,
        };
      }
      const auto = hljs.highlightAuto(code);
      return { html: auto.value, language: auto.language || "text" };
    } catch {
      return { html: escapeHtml(code), language: lang || "text" };
    }
  }, [code, lang]);

  function copy() {
    navigator.clipboard?.writeText(code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  return (
    <div className="my-1.5 max-w-2xl overflow-hidden rounded-xl border border-[#30363d]">
      <div className="flex items-center justify-between bg-[#161b22] px-3 py-1 text-xs text-[#8b949e]">
        <span className="font-mono">{language}</span>
        <button
          className="flex items-center gap-1 hover:text-[#e6edf3]"
          onClick={copy}
        >
          {copied ? <Check size={13} /> : <Copy size={13} />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre className="!m-0 overflow-x-auto bg-[#0d1117] p-3 text-[0.85rem] leading-relaxed">
        <code
          className="hljs"
          dangerouslySetInnerHTML={{ __html: html }}
        />
      </pre>
    </div>
  );
}

function escapeHtml(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
