import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import { useStore } from "../store";
import type { SearchResult } from "../types";
import { formatDate, formatTime } from "../format";
import { Search as SearchIcon, Hash, MessageSquare, X } from "lucide-react";

export default function Search() {
  const setSearchOpen = useStore((s) => s.setSearchOpen);
  const setView = useStore((s) => s.setView);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => inputRef.current?.focus(), []);

  // Debounced search.
  useEffect(() => {
    const term = q.trim();
    if (!term) {
      setResults([]);
      return;
    }
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        setResults(await api.get<SearchResult[]>(`/api/search?q=${encodeURIComponent(term)}`));
      } finally {
        setLoading(false);
      }
    }, 200);
    return () => clearTimeout(t);
  }, [q]);

  async function open(r: SearchResult) {
    setSearchOpen(false);
    if (r.location.type === "channel") await setView({ type: "channel", id: r.location.id });
    else await setView({ type: "dm", id: r.location.id });
    // Best-effort: scroll to the message if it's in the loaded window.
    setTimeout(() => {
      const el = document.getElementById(`msg-${r.id}`);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        el.classList.add("flash");
        setTimeout(() => el.classList.remove("flash"), 1200);
      }
    }, 250);
  }

  function highlight(text: string) {
    const term = q.trim();
    if (!term) return text;
    const idx = text.toLowerCase().indexOf(term.toLowerCase());
    if (idx < 0) return text.slice(0, 160);
    const start = Math.max(0, idx - 40);
    return (
      <>
        {start > 0 && "…"}
        {text.slice(start, idx)}
        <mark className="rounded bg-[var(--c-accent-soft)] px-0.5 text-[var(--c-accent)]">
          {text.slice(idx, idx + term.length)}
        </mark>
        {text.slice(idx + term.length, idx + term.length + 80)}
      </>
    );
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 p-4 pt-[10vh]"
      onClick={() => setSearchOpen(false)}
    >
      <div
        className="card flex max-h-[70vh] w-full max-w-xl flex-col overflow-hidden shadow-2xl fade-in"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-[var(--c-border)] px-3">
          <SearchIcon size={18} className="text-[var(--c-muted)]" />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => e.key === "Escape" && setSearchOpen(false)}
            placeholder="Search messages…"
            className="flex-1 bg-transparent py-3 text-sm outline-none"
          />
          <button onClick={() => setSearchOpen(false)} className="text-[var(--c-muted)] hover:text-[var(--c-text)]">
            <X size={18} />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {q.trim() && !loading && results.length === 0 && (
            <div className="px-6 py-8 text-center text-sm text-[var(--c-muted)]">
              Nothing found for “{q.trim()}”.
            </div>
          )}
          {!q.trim() && (
            <div className="px-6 py-8 text-center text-sm text-[var(--c-muted)]">
              Search across every channel and your DMs.
            </div>
          )}
          {results.map((r) => (
            <button
              key={r.id}
              onClick={() => open(r)}
              className="flex w-full flex-col gap-0.5 rounded-lg px-2.5 py-2 text-left transition hover:bg-[var(--c-elevated)]"
            >
              <div className="flex items-center gap-1.5 text-xs text-[var(--c-muted)]">
                {r.location.type === "channel" ? (
                  <>
                    <Hash size={12} />
                    {r.location.name}
                  </>
                ) : (
                  <>
                    <MessageSquare size={12} />
                    {r.location.with}
                  </>
                )}
                <span>·</span>
                <span style={{ color: r.color }}>{r.author}</span>
                <span>·</span>
                {formatDate(r.created_at)} {formatTime(r.created_at)}
              </div>
              <div className="text-sm">{highlight(r.content)}</div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
