import { useMemo, useRef, useState } from "react";
import { api } from "../api";
import { useStore } from "../store";
import { sendTyping } from "../ws";
import { matchCommands, runCommand, type CommandContext } from "../commands";
import type { FileItem, View } from "../types";
import { formatBytes } from "../format";
import { Paperclip, SendHorizontal, X, Loader2, Code2 } from "lucide-react";

export default function Composer({
  view,
  dmWith,
}: {
  view: View;
  dmWith?: string;
}) {
  const [text, setText] = useState("");
  const [attachments, setAttachments] = useState<FileItem[]>([]);
  const [uploading, setUploading] = useState(false);
  const [sending, setSending] = useState(false);
  const [widgetMode, setWidgetMode] = useState(false);
  const [paletteIndex, setPaletteIndex] = useState(0);
  const [paletteClosed, setPaletteClosed] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const lastTyping = useRef(0);
  const taRef = useRef<HTMLTextAreaElement>(null);

  const user = useStore((s) => s.user);
  const openDm = useStore((s) => s.openDm);
  const refreshChannels = useStore((s) => s.refreshChannels);
  const addLocalMessage = useStore((s) => s.addLocalMessage);
  const replyTarget = useStore((s) => s.replyTarget);
  const setReplyTarget = useStore((s) => s.setReplyTarget);

  const endpoint =
    view.type === "channel"
      ? `/api/channels/${view.id}/messages`
      : `/api/dms/${(view as any).id}/messages`;

  // The command palette shows while typing a bare command token (no space yet).
  const matches = useMemo(
    () => (text.startsWith("/") && !text.includes(" ") ? matchCommands(text) : []),
    [text]
  );
  const showPalette = !widgetMode && !paletteClosed && matches.length > 0;

  function makeCtx(): CommandContext {
    return {
      view,
      user: user!,
      channelId: view.type === "channel" ? view.id : undefined,
      send: async (content) => {
        await api.post(endpoint, { content, attachments: [] });
      },
      addLocal: (content, kind) => addLocalMessage(content, kind),
      openDm,
      refreshChannels,
    };
  }

  function completeCommand(name: string) {
    setText(`/${name} `);
    setPaletteClosed(true);
    taRef.current?.focus();
  }

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setUploading(true);
    try {
      for (const file of Array.from(files)) {
        const uploaded = await api.upload(file);
        setAttachments((a) => [...a, uploaded]);
      }
    } catch (e: any) {
      alert(e.message || "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  function resetInput() {
    setText("");
    setAttachments([]);
    setWidgetMode(false);
    setPaletteClosed(false);
    setReplyTarget(null);
    if (taRef.current) taRef.current.style.height = "auto";
  }

  async function send() {
    if (sending) return;
    const trimmed = text.trim();
    if (!trimmed && attachments.length === 0) return;
    setSending(true);
    try {
      // Slash commands (only when there's no attachment / widget payload).
      if (trimmed.startsWith("/") && !widgetMode && attachments.length === 0) {
        const handled = await runCommand(trimmed, makeCtx());
        if (handled) {
          resetInput();
          return;
        }
      }
      const content =
        widgetMode && trimmed ? "```html\n" + text + "\n```" : text;
      await api.post(endpoint, {
        content,
        attachments: attachments.map((a) => a.id),
        reply_to: replyTarget?.id ?? null,
      });
      resetInput();
    } catch (e: any) {
      alert(e.message || "Could not send");
    } finally {
      setSending(false);
    }
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (showPalette) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setPaletteIndex((i) => (i + 1) % matches.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setPaletteIndex((i) => (i - 1 + matches.length) % matches.length);
        return;
      }
      if (e.key === "Tab" || (e.key === "Enter" && !e.shiftKey)) {
        e.preventDefault();
        completeCommand(matches[Math.min(paletteIndex, matches.length - 1)].name);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setPaletteClosed(true);
        return;
      }
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

  function onChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    setText(e.target.value);
    setPaletteIndex(0);
    setPaletteClosed(false);
    const ta = e.target;
    ta.style.height = "auto";
    ta.style.height = `${Math.min(ta.scrollHeight, 200)}px`;
    const now = Date.now();
    if (now - lastTyping.current > 1500) {
      lastTyping.current = now;
      sendTyping(
        view.type === "channel"
          ? { channel_id: view.id }
          : { dm_id: (view as any).id, with: dmWith }
      );
    }
  }

  return (
    <div
      className="px-4 pb-4 md:pb-[calc(1rem+env(safe-area-inset-bottom))]"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        e.stopPropagation();
        handleFiles(e.dataTransfer.files);
      }}
    >
      {showPalette && (
        <div className="card mb-2 overflow-hidden p-1 fade-in">
          <div className="px-2 py-1 text-[10px] uppercase tracking-wide text-[var(--c-muted)]">
            Commands — ↑/↓ to navigate, Tab to complete
          </div>
          {matches.map((c, i) => (
            <button
              key={c.name}
              onMouseEnter={() => setPaletteIndex(i)}
              onClick={() => completeCommand(c.name)}
              className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm ${
                i === paletteIndex
                  ? "bg-[var(--c-accent-soft)]"
                  : "hover:bg-[var(--c-elevated)]"
              }`}
            >
              <span className="font-mono text-[var(--c-accent)]">/{c.name}</span>
              {c.args && (
                <span className="font-mono text-xs text-[var(--c-muted)]">
                  {c.args}
                </span>
              )}
              <span className="ml-auto truncate pl-3 text-xs text-[var(--c-muted)]">
                {c.description}
              </span>
            </button>
          ))}
        </div>
      )}
      <div className="card p-2">
        {replyTarget && (
          <div className="mb-2 flex items-center gap-2 rounded-lg bg-[var(--c-elevated)] px-2 py-1.5 text-xs">
            <span className="text-[var(--c-muted)]">Replying to</span>
            <span className="font-medium" style={{ color: replyTarget.color }}>
              {replyTarget.author}
            </span>
            <span className="min-w-0 flex-1 truncate text-[var(--c-muted)]">
              {replyTarget.content.replace(/\n/g, " ") || "attachment"}
            </span>
            <button
              onClick={() => setReplyTarget(null)}
              className="text-[var(--c-muted)] hover:text-red-300"
            >
              <X size={14} />
            </button>
          </div>
        )}
        {attachments.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-2 px-1">
            {attachments.map((a) => (
              <div
                key={a.id}
                className="flex items-center gap-2 rounded-lg bg-[var(--c-elevated)] px-2 py-1 text-xs"
              >
                <span className="max-w-40 truncate">{a.name}</span>
                <span className="text-[var(--c-muted)]">{formatBytes(a.size)}</span>
                <button
                  onClick={() =>
                    setAttachments((list) => list.filter((x) => x.id !== a.id))
                  }
                  className="text-[var(--c-muted)] hover:text-red-300"
                >
                  <X size={14} />
                </button>
              </div>
            ))}
          </div>
        )}
        <div className="flex items-end gap-2">
          <button
            className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-[var(--c-muted)] transition hover:bg-[var(--c-elevated)] hover:text-[var(--c-text)]"
            onClick={() => fileRef.current?.click()}
            title="Attach files"
          >
            {uploading ? (
              <Loader2 size={18} className="animate-spin" />
            ) : (
              <Paperclip size={18} />
            )}
          </button>
          <input
            ref={fileRef}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => handleFiles(e.target.files)}
          />
          <button
            className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg transition hover:bg-[var(--c-elevated)] ${
              widgetMode
                ? "text-[var(--c-accent)]"
                : "text-[var(--c-muted)] hover:text-[var(--c-text)]"
            }`}
            onClick={() => setWidgetMode((v) => !v)}
            title="Send as sandboxed HTML widget"
          >
            <Code2 size={18} />
          </button>
          <textarea
            ref={taRef}
            rows={1}
            value={text}
            onChange={onChange}
            onKeyDown={onKeyDown}
            placeholder={
              widgetMode ? "Paste HTML — sandboxed widget…" : "Write a message…"
            }
            className={`max-h-48 flex-1 resize-none bg-transparent py-2 text-sm outline-none ${
              widgetMode ? "font-mono text-xs" : ""
            }`}
          />
          <button
            className="btn btn-primary !px-3"
            onClick={send}
            disabled={sending || (!text.trim() && attachments.length === 0)}
          >
            <SendHorizontal size={16} />
          </button>
        </div>
      </div>
    </div>
  );
}
