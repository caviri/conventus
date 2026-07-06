import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { api } from "../api";
import { useStore } from "../store";
import {
  EMOJI_GROUPS,
  emojiCatalog,
  loadEmojiData,
  pushRecentEmoji,
  recentEmoji,
  searchEmoji,
} from "../emojiData";
import { Clock, Loader2, Plus, Search, Sparkles } from "lucide-react";

export type EmojiPick = { native?: string; custom?: string };

// One picker for the whole app (message toolbar + composer). Renders through a
// portal, anchored to the trigger button; on phones it becomes a bottom sheet.
export default function EmojiPicker({
  anchor,
  onPick,
  onClose,
}: {
  anchor: HTMLElement | null;
  onPick: (pick: EmojiPick) => void;
  onClose: () => void;
}) {
  const emojis = useStore((s) => s.emojis);
  const refreshEmojis = useStore((s) => s.refreshEmojis);
  const [ready, setReady] = useState(!!emojiCatalog());
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState<string>("recent");
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [newFile, setNewFile] = useState<File | null>(null);
  const [newPreview, setNewPreview] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    loadEmojiData().then(() => setReady(true));
  }, []);

  // Object URL for the staged file, revoked on change/unmount so we don't leak.
  useEffect(() => {
    if (!newFile) return setNewPreview(null);
    const url = URL.createObjectURL(newFile);
    setNewPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [newFile]);

  // Close on outside press or Escape.
  useEffect(() => {
    function onDown(e: PointerEvent) {
      if (panelRef.current?.contains(e.target as Node)) return;
      if (anchor?.contains(e.target as Node)) return;
      onClose();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [anchor, onClose]);

  const phone = window.innerWidth < 640;
  const style = useMemo<React.CSSProperties>(() => {
    if (phone) return {}; // bottom sheet — positioned by classes
    const W = 336;
    const H = 400;
    const rect = anchor?.getBoundingClientRect();
    if (!rect) return { position: "fixed", right: 16, bottom: 16, width: W, height: H };
    const left = Math.min(Math.max(8, rect.right - W), window.innerWidth - W - 8);
    let top = rect.bottom + 6;
    if (top + H > window.innerHeight - 8) top = Math.max(8, rect.top - H - 6);
    return { position: "fixed", left, top, width: W, height: H };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anchor, phone]);

  function pick(value: EmojiPick) {
    pushRecentEmoji(value.native ?? `:${value.custom}:`);
    onPick(value);
  }

  const customByName = useMemo(
    () => Object.fromEntries(emojis.map((e) => [e.name, e.url])),
    [emojis]
  );

  const q = query.trim().toLowerCase();
  const searchResults = useMemo(() => {
    if (!q) return null;
    const custom = emojis
      .filter((e) => e.name.includes(q))
      .sort((a, b) => Number(b.name.startsWith(q)) - Number(a.name.startsWith(q)));
    return { custom, native: ready ? searchEmoji(q, 72) : [] };
  }, [q, emojis, ready]);

  async function addEmoji() {
    if (!newFile || !newName.trim() || uploading) return;
    setUploading(true);
    try {
      await api.uploadEmoji(newName.trim(), newFile);
      await refreshEmojis();
      setAdding(false);
      setNewName("");
      setNewFile(null);
      setTab("custom");
    } catch (e: any) {
      alert(e.message || "Could not add emoji");
    } finally {
      setUploading(false);
    }
  }

  function pickFile(f: File | undefined) {
    if (!f) return;
    setNewFile(f);
    if (!newName) {
      // Suggest a name from the filename: "Party Parrot.gif" → party-parrot
      const slug = f.name
        .replace(/\.[^.]+$/, "")
        .toLowerCase()
        .replace(/[^a-z0-9_+-]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 32);
      setNewName(slug);
    }
  }

  const emojiBtn =
    "grid h-9 w-9 cursor-pointer place-items-center rounded-lg text-[22px] leading-none hover:bg-[var(--c-elevated)]";

  function nativeGrid(list: { unicode: string; label: string }[]) {
    return (
      <div className="grid grid-cols-8">
        {list.map((e) => (
          <button
            key={e.unicode}
            className={emojiBtn}
            title={e.label}
            onClick={() => pick({ native: e.unicode })}
          >
            {e.unicode}
          </button>
        ))}
      </div>
    );
  }

  function customGrid(list: { name: string; url: string }[]) {
    return (
      <div className="grid grid-cols-8">
        {list.map((e) => (
          <button
            key={e.name}
            className={emojiBtn}
            title={`:${e.name}:`}
            onClick={() => pick({ custom: e.name })}
          >
            <img src={e.url} alt={`:${e.name}:`} className="h-6 w-6 object-contain" />
          </button>
        ))}
      </div>
    );
  }

  function recentGrid() {
    const items = recentEmoji();
    return (
      <div className="grid grid-cols-8">
        {items.map((v) => {
          const custom = v.match(/^:([a-z0-9_+-]+):$/);
          if (custom) {
            const url = customByName[custom[1]];
            if (!url) return null; // emoji has since been deleted
            return (
              <button key={v} className={emojiBtn} title={v} onClick={() => pick({ custom: custom[1] })}>
                <img src={url} alt={v} className="h-6 w-6 object-contain" />
              </button>
            );
          }
          return (
            <button key={v} className={emojiBtn} onClick={() => pick({ native: v })}>
              {v}
            </button>
          );
        })}
      </div>
    );
  }

  const catalog = emojiCatalog();
  const groupList = useMemo(() => {
    if (typeof tab !== "string" || !catalog) return [];
    const id = Number(tab);
    return Number.isNaN(id) ? [] : catalog.filter((e) => e.group === id);
  }, [tab, catalog]);

  const tabBtn = (active: boolean) =>
    `grid h-8 w-8 shrink-0 place-items-center rounded-lg text-base ${
      active ? "bg-[var(--c-accent-soft)]" : "hover:bg-[var(--c-elevated)] opacity-70"
    }`;

  const panel = (
    <div
      ref={panelRef}
      style={style}
      className={`z-50 flex flex-col overflow-hidden rounded-xl border border-[var(--c-border)] bg-[var(--c-surface)] shadow-2xl fade-in ${
        phone
          ? "fixed inset-x-2 bottom-2 h-[420px] max-h-[60vh] pb-[env(safe-area-inset-bottom)]"
          : ""
      }`}
    >
      <div className="flex items-center gap-2 border-b border-[var(--c-border)] p-2">
        <Search size={15} className="shrink-0 text-[var(--c-muted)]" />
        <input
          autoFocus={!phone}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== "Enter" || !searchResults) return;
            const c = searchResults.custom[0];
            const n = searchResults.native[0];
            if (c) pick({ custom: c.name });
            else if (n) pick({ native: n.unicode });
          }}
          placeholder="Search emoji…"
          className="w-full bg-transparent text-sm outline-none"
        />
        {!ready && <Loader2 size={15} className="shrink-0 animate-spin text-[var(--c-muted)]" />}
      </div>

      {!q && (
        <div className="flex items-center gap-0.5 overflow-x-auto border-b border-[var(--c-border)] px-2 py-1.5">
          <button className={tabBtn(tab === "recent")} title="Recently used" onClick={() => setTab("recent")}>
            <Clock size={15} className="text-[var(--c-muted)]" />
          </button>
          <button className={tabBtn(tab === "custom")} title="This room's emoji" onClick={() => setTab("custom")}>
            <Sparkles size={15} className="text-[var(--c-accent)]" />
          </button>
          {EMOJI_GROUPS.map((g) => (
            <button key={g.id} className={tabBtn(tab === String(g.id))} title={g.label} onClick={() => setTab(String(g.id))}>
              {g.icon}
            </button>
          ))}
        </div>
      )}

      <div className="flex-1 overflow-y-auto p-2">
        {q && searchResults ? (
          <>
            {searchResults.custom.length > 0 && (
              <>
                <div className="px-1 pb-1 text-[10px] uppercase tracking-wide text-[var(--c-muted)]">
                  Room emoji
                </div>
                {customGrid(searchResults.custom)}
              </>
            )}
            {searchResults.native.length > 0 && searchResults.custom.length > 0 && (
              <div className="px-1 pb-1 pt-2 text-[10px] uppercase tracking-wide text-[var(--c-muted)]">
                Emoji
              </div>
            )}
            {nativeGrid(searchResults.native)}
            {searchResults.custom.length === 0 && searchResults.native.length === 0 && (
              <p className="p-3 text-center text-sm text-[var(--c-muted)]">No emoji found</p>
            )}
          </>
        ) : tab === "recent" ? (
          recentGrid()
        ) : tab === "custom" ? (
          emojis.length > 0 ? (
            customGrid(emojis)
          ) : (
            <p className="p-3 text-center text-sm text-[var(--c-muted)]">
              No custom emoji yet — add the first one below 🎨
            </p>
          )
        ) : ready ? (
          nativeGrid(groupList)
        ) : (
          <p className="p-3 text-center text-sm text-[var(--c-muted)]">Loading emoji…</p>
        )}
      </div>

      <div className="border-t border-[var(--c-border)] p-2">
        {adding ? (
          <div className="flex items-center gap-1.5">
            <button
              className="btn !px-2 !py-1 text-xs"
              onClick={() => fileRef.current?.click()}
              title="Choose a PNG, GIF or WebP (max 512 KB)"
            >
              {newFile && newPreview ? (
                <img src={newPreview} alt="" className="h-5 w-5 object-contain" />
              ) : (
                "Image…"
              )}
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="image/png,image/gif,image/webp,image/jpeg"
              className="hidden"
              onChange={(e) => pickFile(e.target.files?.[0])}
            />
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value.toLowerCase())}
              onKeyDown={(e) => e.key === "Enter" && addEmoji()}
              placeholder="name"
              className="input !py-1 min-w-0 flex-1 font-mono text-xs"
            />
            <button
              className="btn btn-primary !px-2 !py-1 text-xs"
              disabled={!newFile || !newName.trim() || uploading}
              onClick={addEmoji}
            >
              {uploading ? <Loader2 size={13} className="animate-spin" /> : "Add"}
            </button>
          </div>
        ) : (
          <button
            className="flex w-full items-center gap-1.5 rounded-lg px-2 py-1 text-xs text-[var(--c-muted)] hover:bg-[var(--c-elevated)] hover:text-[var(--c-text)]"
            onClick={() => setAdding(true)}
          >
            <Plus size={13} /> Add a custom emoji to the room
          </button>
        )}
      </div>
    </div>
  );

  return createPortal(panel, document.body);
}
