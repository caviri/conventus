import { memo, useState } from "react";
import type { Message as MessageType } from "../types";
import { formatTime, renderContent, splitSegments } from "../format";
import { useStore } from "../store";
import { api } from "../api";
import Attachment from "./Attachment";
import LinkPreview from "./LinkPreview";
import HtmlWidget from "./HtmlWidget";
import CodeBlock from "./CodeBlock";
import Avatar from "./Avatar";
import { SmilePlus, Pencil, Trash2, Check, X, Reply, CornerUpRight, Pin, Link2 } from "lucide-react";

const QUICK_EMOJI = ["👍", "❤️", "😂", "🎉", "🚀", "👀", "✅", "🔥"];

function MessageRow({
  message,
  grouped,
}: {
  message: MessageType;
  grouped: boolean;
}) {
  const user = useStore((s) => s.user);
  const setReplyTarget = useStore((s) => s.setReplyTarget);
  const [picker, setPicker] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(message.content);
  const [linked, setLinked] = useState(false);

  if (message.kind === "system") {
    return (
      <div className="my-3 flex items-center gap-3 px-4">
        <div className="h-px flex-1 bg-[var(--c-border)]" />
        <span className="text-[10px] uppercase tracking-wide text-[var(--c-muted)]">
          {message.content}
        </span>
        <div className="h-px flex-1 bg-[var(--c-border)]" />
      </div>
    );
  }

  const isLocal = message.id < 0; // ephemeral, client-only (slash-command output)
  const mine = message.author === user?.name;
  const canEdit = mine && message.kind !== "bot";
  const canDelete = mine || user?.is_admin;

  async function react(emoji: string) {
    setPicker(false);
    await api.post(`/api/messages/${message.id}/reactions`, { emoji });
  }

  async function saveEdit() {
    if (!draft.trim() || draft === message.content) {
      setEditing(false);
      return;
    }
    await api.patch(`/api/messages/${message.id}`, { content: draft });
    setEditing(false);
  }

  async function remove() {
    if (!confirm("Delete this message?")) return;
    await api.del(`/api/messages/${message.id}`);
  }

  async function togglePin() {
    await api.post(`/api/messages/${message.id}/pin`);
  }

  function copyLink() {
    const url = `${location.origin}/?msg=${message.channel_id}-${message.id}`;
    navigator.clipboard?.writeText(url).then(() => {
      setLinked(true);
      setTimeout(() => setLinked(false), 1500);
    });
  }

  function scrollToParent() {
    const el = document.getElementById(`msg-${message.reply_to}`);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      el.classList.add("flash");
      setTimeout(() => el.classList.remove("flash"), 1200);
    }
  }

  return (
    <div
      id={`msg-${message.id}`}
      className={`group relative flex gap-3 px-4 ${
        grouped ? "mt-0.5" : "mt-4"
      } hover:bg-[var(--c-hover)]`}
    >
      {/* Action toolbar — hover-revealed on desktop, always shown on touch. */}
      <div className={`msg-actions absolute right-3 top-0 z-10 ${isLocal ? "!hidden" : ""} -translate-y-1/2 items-center gap-0.5 rounded-lg border border-[var(--c-border)] bg-[var(--c-elevated)] p-0.5 shadow-lg`}>
        <div className="relative">
          <button
            className="grid h-7 w-7 place-items-center rounded text-[var(--c-muted)] hover:bg-[var(--c-surface-2)] hover:text-[var(--c-text)]"
            onClick={() => setPicker((v) => !v)}
            title="React"
          >
            <SmilePlus size={15} />
          </button>
          {picker && (
            <div className="absolute right-0 top-8 z-20 flex gap-1 rounded-lg border border-[var(--c-border)] bg-[var(--c-elevated)] p-1.5 shadow-xl fade-in">
              {QUICK_EMOJI.map((e) => (
                <button
                  key={e}
                  className="rounded p-1 text-lg hover:bg-[var(--c-surface-2)]"
                  onClick={() => react(e)}
                >
                  {e}
                </button>
              ))}
            </div>
          )}
        </div>
        <button
          className="grid h-7 w-7 place-items-center rounded text-[var(--c-muted)] hover:bg-[var(--c-surface-2)] hover:text-[var(--c-text)]"
          onClick={() => setReplyTarget(message)}
          title="Reply"
        >
          <Reply size={14} />
        </button>
        <button
          className={`grid h-7 w-7 place-items-center rounded hover:bg-[var(--c-surface-2)] ${
            message.pinned ? "text-[var(--c-accent)]" : "text-[var(--c-muted)] hover:text-[var(--c-text)]"
          }`}
          onClick={togglePin}
          title={message.pinned ? "Unpin" : "Pin"}
        >
          <Pin size={14} />
        </button>
        {message.channel_id && (
          <button
            className="grid h-7 w-7 place-items-center rounded text-[var(--c-muted)] hover:bg-[var(--c-surface-2)] hover:text-[var(--c-text)]"
            onClick={copyLink}
            title={linked ? "Link copied" : "Copy link to message"}
          >
            {linked ? <Check size={14} className="text-emerald-400" /> : <Link2 size={14} />}
          </button>
        )}
        {canEdit && (
          <button
            className="grid h-7 w-7 place-items-center rounded text-[var(--c-muted)] hover:bg-[var(--c-surface-2)] hover:text-[var(--c-text)]"
            onClick={() => {
              setDraft(message.content);
              setEditing(true);
            }}
            title="Edit"
          >
            <Pencil size={14} />
          </button>
        )}
        {canDelete && (
          <button
            className="grid h-7 w-7 place-items-center rounded text-[var(--c-muted)] hover:bg-[var(--c-surface-2)] hover:text-red-300"
            onClick={remove}
            title="Delete"
          >
            <Trash2 size={14} />
          </button>
        )}
      </div>

      <div className="w-9 shrink-0">
        {!grouped && (
          <Avatar avatar={message.avatar} name={message.author} color={message.color} className="h-9 w-9" />
        )}
      </div>

      <div className="min-w-0 flex-1">
        {message.pinned && (
          <div className="mb-0.5 flex items-center gap-1 text-[11px] font-medium text-[var(--c-accent)]">
            <Pin size={11} /> Pinned
          </div>
        )}
        {message.reply_preview && (
          <button
            onClick={scrollToParent}
            className="mb-0.5 flex max-w-full items-center gap-1.5 text-left text-xs text-[var(--c-muted)] hover:text-[var(--c-text)]"
          >
            <CornerUpRight size={12} className="shrink-0" />
            <span className="font-medium">{message.reply_preview.author}</span>
            <span className="truncate opacity-80">
              {message.reply_preview.content || "attachment"}
            </span>
          </button>
        )}
        {!grouped && (
          <div className="flex items-baseline gap-2">
            <span className="font-semibold" style={{ color: message.color }}>
              {message.author}
            </span>
            {message.kind === "bot" && (
              <span className="rounded bg-[var(--c-elevated)] px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-[var(--c-muted)]">
                bot
              </span>
            )}
            <span className="text-xs text-[var(--c-muted)]">
              {formatTime(message.created_at)}
            </span>
          </div>
        )}

        {editing ? (
          <div className="mt-1">
            <textarea
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  saveEdit();
                }
                if (e.key === "Escape") setEditing(false);
              }}
              className="input min-h-16 resize-y text-sm"
            />
            <div className="mt-1 flex gap-2">
              <button className="btn btn-primary !py-1 text-xs" onClick={saveEdit}>
                <Check size={13} /> Save
              </button>
              <button className="btn !py-1 text-xs" onClick={() => setEditing(false)}>
                <X size={13} /> Cancel
              </button>
            </div>
          </div>
        ) : (
          message.content && (
            <div className="msg-content text-[0.95rem] leading-relaxed">
              {splitSegments(message.content).map((seg, i) =>
                seg.type === "html" ? (
                  <HtmlWidget key={i} html={seg.value} />
                ) : seg.type === "code" ? (
                  <CodeBlock key={i} code={seg.value} lang={seg.lang} />
                ) : (
                  seg.value.trim() && (
                    <span
                      key={i}
                      dangerouslySetInnerHTML={{ __html: renderContent(seg.value) }}
                    />
                  )
                )
              )}
              {message.edited_at && (
                <span className="ml-1.5 text-xs text-[var(--c-muted)]">(edited)</span>
              )}
            </div>
          )
        )}

        {message.attachments.length > 0 && (
          <div className="mt-1.5 flex flex-col gap-2">
            {message.attachments.map((a) => (
              <Attachment key={a.id} a={a} />
            ))}
          </div>
        )}
        {message.previews.length > 0 && (
          <div className="mt-1.5 flex flex-col gap-2">
            {message.previews.map((p, i) => (
              <LinkPreview key={i} p={p} />
            ))}
          </div>
        )}

        {message.reactions.length > 0 && (
          <div className="mt-1.5 flex flex-wrap gap-1">
            {message.reactions.map((r) => {
              const mineReacted = !!user && r.users.includes(user.name);
              return (
                <button
                  key={r.emoji}
                  onClick={() => react(r.emoji)}
                  title={r.users.join(", ")}
                  className={`flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs transition ${
                    mineReacted
                      ? "border-[var(--c-accent)] bg-[var(--c-accent-soft)]"
                      : "border-[var(--c-border)] bg-[var(--c-elevated)] hover:border-[var(--c-accent)]"
                  }`}
                >
                  <span>{r.emoji}</span>
                  <span className="text-[var(--c-muted)]">{r.count}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// Memoized: an incoming message only re-renders the rows whose data changed,
// not the whole history.
const Message = memo(MessageRow);
export default Message;
