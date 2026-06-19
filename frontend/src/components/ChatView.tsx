import { Fragment, useEffect, useRef, useState } from "react";
import { useStore, viewKey } from "../store";
import { api } from "../api";
import Message from "./Message";
import Composer from "./Composer";
import Avatar from "./Avatar";
import { promptName } from "./PromptModal";
import type { Message as MessageType } from "../types";
import EmptyState from "./EmptyState";
import { formatDate } from "../format";
import { Hash, Circle, Pencil, Pin, X, ArrowDown, Trash2, Sparkles, ListTree, CornerDownRight, ChevronDown } from "lucide-react";

function DateDivider({ ts }: { ts: number }) {
  return (
    <div className="my-3 flex items-center gap-3 px-4">
      <div className="h-px flex-1 bg-[var(--c-border)]" />
      <span className="rounded-full border border-[var(--c-border)] bg-[var(--c-surface)] px-3 py-0.5 text-xs font-medium text-[var(--c-muted)]">
        {formatDate(ts)}
      </span>
      <div className="h-px flex-1 bg-[var(--c-border)]" />
    </div>
  );
}

export default function ChatView() {
  const view = useStore((s) => s.view);
  const channels = useStore((s) => s.channels);
  const dms = useStore((s) => s.dms);
  const conversations = useStore((s) => s.conversations);
  const agent = useStore((s) => s.agent);
  const renameConversation = useStore((s) => s.renameConversation);
  const deleteConversation = useStore((s) => s.deleteConversation);
  const addConversationDivider = useStore((s) => s.addConversationDivider);
  const user = useStore((s) => s.user);
  const messages = useStore((s) => s.messages);
  const typing = useStore((s) => s.typing);
  const refreshChannels = useStore((s) => s.refreshChannels);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [editingTopic, setEditingTopic] = useState(false);
  const [topicDraft, setTopicDraft] = useState("");
  const [pins, setPins] = useState<MessageType[]>([]);
  const [pinsOpen, setPinsOpen] = useState(false);
  const [newCount, setNewCount] = useState(0);
  const [scrolled, setScrolled] = useState(false);
  const atBottom = useRef(true);
  const prevLen = useRef(0);
  // Threads render inline under their root message. `expandAll` opens every
  // thread at once (the "not like Slack" mode); `threadOverride` lets a single
  // thread be toggled against that default.
  const [expandAll, setExpandAll] = useState(false);
  const [threadOverride, setThreadOverride] = useState<Record<number, boolean>>({});
  const isThreadOpen = (id: number) =>
    id in threadOverride ? threadOverride[id] : expandAll;
  const toggleThread = (id: number) =>
    setThreadOverride((o) => ({ ...o, [id]: !isThreadOpen(id) }));
  const toggleAllThreads = () => {
    setExpandAll((v) => !v);
    setThreadOverride({});
  };

  const key = viewKey(view);
  const list = messages[key] || [];

  // Group replies under the root of their reply chain. Roots stay in the main
  // timeline; replies are pulled out and rendered indented beneath their root.
  const byId = new Map(list.map((m) => [m.id, m]));
  const rootIdOf = (m: MessageType): number => {
    let cur = m;
    const seen = new Set<number>();
    while (cur.reply_to && byId.has(cur.reply_to) && !seen.has(cur.id)) {
      seen.add(cur.id);
      cur = byId.get(cur.reply_to)!;
    }
    return cur.id;
  };
  const threadReplies = new Map<number, MessageType[]>();
  const roots: MessageType[] = [];
  for (const m of list) {
    const rid = rootIdOf(m);
    if (rid === m.id) roots.push(m);
    else {
      const arr = threadReplies.get(rid) || [];
      arr.push(m);
      threadReplies.set(rid, arr);
    }
  }
  const hasThreads = threadReplies.size > 0;

  const channel =
    view.type === "channel" ? channels.find((c) => c.id === view.id) : undefined;
  const dm = view.type === "dm" ? dms.find((d) => d.id === view.id) : undefined;
  const conv =
    view.type === "conversation"
      ? conversations.find((c) => c.id === view.id)
      : undefined;

  async function renameConv() {
    if (!conv) return;
    const next = await promptName({ title: "Rename conversation", initial: conv.title, confirmLabel: "Rename" });
    if (next && next !== conv.title) await renameConversation(conv.id, next);
  }

  function scrollToBottom() {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
    atBottom.current = true;
    setNewCount(0);
    setScrolled(false);
  }

  function onScroll() {
    const el = scrollRef.current;
    if (!el) return;
    atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
    setScrolled(!atBottom.current);
    if (atBottom.current) setNewCount(0);
  }

  // Switching conversations: jump to the latest message.
  useEffect(() => {
    prevLen.current = list.length;
    scrollToBottom();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  // New messages: follow only if the reader is already at the bottom, else
  // surface a "jump to latest" pill with a count.
  useEffect(() => {
    const grew = list.length - prevLen.current;
    prevLen.current = list.length;
    if (atBottom.current) scrollToBottom();
    else if (grew > 0) setNewCount((c) => c + grew);
  }, [list.length]);

  // Keep the pins panel in sync: reload when the channel changes or a loaded
  // message's pinned state flips.
  const pinnedSig = list.filter((m) => m.pinned).map((m) => m.id).join(",");
  useEffect(() => {
    setPinsOpen(false);
    if (!channel) {
      setPins([]);
      return;
    }
    api.get<MessageType[]>(`/api/channels/${channel.id}/pins`).then(setPins).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channel?.id, pinnedSig]);

  function jumpTo(id: number) {
    setPinsOpen(false);
    const el = document.getElementById(`msg-${id}`);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      el.classList.add("flash");
      setTimeout(() => el.classList.remove("flash"), 1200);
    }
  }

  // Re-render once a second while anyone's typing so stale indicators (e.g. a
  // bot that pinged "typing" but errored before replying) age out via the 5s rule.
  const [, typingTick] = useState(0);
  useEffect(() => {
    if (!(typing[key]?.length)) return;
    const t = setInterval(() => typingTick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [typing, key]);

  const typingNames = (typing[key] || [])
    .filter((t) => Date.now() - t.at < 5000 && t.name !== user?.name)
    .map((t) => t.name);

  async function saveTopic() {
    if (!channel) return;
    await api.patch(`/api/channels/${channel.id}`, { topic: topicDraft });
    await refreshChannels();
    setEditingTopic(false);
  }

  async function renameChannel() {
    if (!channel) return;
    const next = await promptName({ title: "Rename channel", initial: channel.name, confirmLabel: "Rename" });
    if (!next || next === channel.name) return;
    await api.patch(`/api/channels/${channel.id}`, { name: next });
    await refreshChannels();
  }

  async function deleteChannel() {
    if (!channel) return;
    if (!window.confirm(`Delete #${channel.name}? All its messages are removed.`))
      return;
    await api.del(`/api/channels/${channel.id}`); // store handles navigation via channel.delete
  }

  return (
    <div className="relative flex h-full flex-col">
      {/* Header */}
      <header className="surface relative flex items-center gap-3 border-b border-[var(--c-border)] px-4 py-3 pl-14 md:pl-4">
        {channel ? (
          <>
            <Hash size={18} className="text-[var(--c-muted)]" />
            <div className="min-w-0">
              {user?.is_admin ? (
                <button
                  onClick={renameChannel}
                  title="Rename channel"
                  className="font-display text-lg font-semibold leading-tight hover:underline"
                >
                  {channel.name}
                </button>
              ) : (
                <div className="font-display text-lg font-semibold leading-tight">
                  {channel.name}
                </div>
              )}
              {editingTopic ? (
                <input
                  autoFocus
                  className="input mt-1 !py-1 text-xs"
                  value={topicDraft}
                  onChange={(e) => setTopicDraft(e.target.value)}
                  onBlur={saveTopic}
                  onKeyDown={(e) => e.key === "Enter" && saveTopic()}
                />
              ) : (
                <div className="flex items-center gap-1.5 text-xs text-[var(--c-muted)]">
                  <span className="truncate">
                    {channel.topic || "No topic"}
                  </span>
                  {user?.is_admin && (
                    <button
                      onClick={() => {
                        setTopicDraft(channel.topic);
                        setEditingTopic(true);
                      }}
                      className="hover:text-[var(--c-text)]"
                    >
                      <Pencil size={11} />
                    </button>
                  )}
                </div>
              )}
            </div>
          </>
        ) : dm ? (
          <>
            <Circle
              size={10}
              fill="currentColor"
              className={dm.online ? "text-emerald-400" : "text-slate-500"}
            />
            <div className="font-semibold">{dm.with}</div>
            <span className="text-xs text-[var(--c-muted)]">
              {dm.online ? "online" : "offline"}
            </span>
          </>
        ) : conv ? (
          <>
            <Avatar
              avatar={agent?.avatar}
              name={agent?.name || "Assistant"}
              color={agent?.color || "#8b5cf6"}
              className="h-7 w-7"
              rounded="rounded-full"
              emojiClass="text-sm"
            />
            <button
              onClick={renameConv}
              title="Rename conversation"
              className="font-semibold hover:underline"
            >
              {conv.title}
            </button>
            <span className="text-xs text-[var(--c-muted)]">
              {agent?.name || "Assistant"}
            </span>
          </>
        ) : null}

        <div className="ml-auto flex items-center gap-1">
          {hasThreads && (
            <button
              className={`btn !py-1.5 text-xs ${expandAll ? "btn-primary" : ""}`}
              onClick={toggleAllThreads}
              title={expandAll ? "Collapse all threads" : "Open every thread inline"}
            >
              <ListTree size={14} /> {expandAll ? "Threads open" : "Threads"}
            </button>
          )}
          {channel && pins.length > 0 && (
            <button
              className="btn !py-1.5 text-xs"
              onClick={() => setPinsOpen((v) => !v)}
              title="Pinned messages"
            >
              <Pin size={14} /> {pins.length}
            </button>
          )}
          {channel && user?.is_admin && !channel.is_default && (
            <button
              className="grid h-8 w-8 place-items-center rounded-lg text-[var(--c-muted)] hover:bg-[var(--c-elevated)] hover:text-red-300"
              onClick={deleteChannel}
              title="Delete channel"
            >
              <Trash2 size={15} />
            </button>
          )}
          {conv && (
            <button
              className="btn !py-1.5 text-xs"
              onClick={() => addConversationDivider(conv.id)}
              title="Start a new conversation — keeps the history above, gives the Assistant a fresh start"
            >
              <Sparkles size={14} /> New
            </button>
          )}
          {conv && (
            <button
              className="grid h-8 w-8 place-items-center rounded-lg text-[var(--c-muted)] hover:bg-[var(--c-elevated)] hover:text-red-300"
              onClick={() => {
                if (window.confirm(`Delete “${conv.title}”?`)) deleteConversation(conv.id);
              }}
              title="Clear this thread"
            >
              <Trash2 size={15} />
            </button>
          )}
        </div>

        {pinsOpen && (
          <div className="card absolute right-3 top-full z-30 mt-1 max-h-96 w-80 max-w-[calc(100vw-1.5rem)] overflow-y-auto p-1 shadow-2xl fade-in">
            <div className="flex items-center justify-between px-2 py-1.5 text-xs font-semibold uppercase tracking-wide text-[var(--c-muted)]">
              Pinned · {pins.length}
              <button onClick={() => setPinsOpen(false)} className="hover:text-[var(--c-text)]">
                <X size={14} />
              </button>
            </div>
            {pins.map((p) => (
              <button
                key={p.id}
                onClick={() => jumpTo(p.id)}
                className="flex w-full flex-col gap-0.5 rounded-lg px-2 py-1.5 text-left hover:bg-[var(--c-elevated)]"
              >
                <span className="text-xs font-medium" style={{ color: p.color }}>
                  {p.author}
                </span>
                <span className="line-clamp-2 text-sm text-[var(--c-muted)]">
                  {p.content.replace(/\n/g, " ") || "attachment"}
                </span>
              </button>
            ))}
          </div>
        )}
      </header>

      {/* Messages */}
      <div ref={scrollRef} onScroll={onScroll} className="flex-1 overflow-y-auto py-4">
        {list.length === 0 && (
          <EmptyState
            title="A quiet little grove"
            subtitle={
              channel
                ? "No messages yet — plant the first one and watch it grow 🌱"
                : conv
                ? "Ask the Assistant anything 🌱"
                : "Say hello to start the conversation 🌱"
            }
          />
        )}
        {roots.map((m, i) => {
          const prev = roots[i - 1];
          const sameDay =
            !!prev &&
            new Date(prev.created_at * 1000).toDateString() ===
              new Date(m.created_at * 1000).toDateString();
          const grouped =
            !!prev &&
            sameDay &&
            prev.author === m.author &&
            prev.kind === m.kind &&
            !m.reply_to &&
            m.created_at - prev.created_at < 300;
          const replies = threadReplies.get(m.id);
          const open = isThreadOpen(m.id);
          const last = replies && replies[replies.length - 1];
          return (
            <Fragment key={m.id}>
              {!sameDay && <DateDivider ts={m.created_at} />}
              <Message message={m} grouped={grouped} />
              {replies && replies.length > 0 && (
                <div className="ml-12 mt-0.5">
                  {!open ? (
                    // Collapsed: a thin log line standing in for the sub-thread.
                    <button
                      onClick={() => toggleThread(m.id)}
                      className="flex items-center gap-2 rounded px-2 py-1 text-xs text-[var(--c-muted)] transition hover:text-[var(--c-text)]"
                    >
                      <CornerDownRight size={13} className="shrink-0" />
                      <span className="font-medium text-[var(--c-accent)]">
                        {replies.length} {replies.length === 1 ? "reply" : "replies"}
                      </span>
                      {last && <span className="opacity-70">last from {last.author}</span>}
                    </button>
                  ) : (
                    <div className="border-l-2 border-[var(--c-accent-soft)] pl-1">
                      <button
                        onClick={() => toggleThread(m.id)}
                        className="flex items-center gap-1.5 px-3 py-1 text-[10px] uppercase tracking-wide text-[var(--c-muted)] hover:text-[var(--c-text)]"
                      >
                        <ChevronDown size={12} /> Thread · {replies.length}
                      </button>
                      {replies.map((r, ri) => {
                        const rprev = replies[ri - 1];
                        const rgrouped =
                          !!rprev &&
                          rprev.author === r.author &&
                          rprev.kind === r.kind &&
                          r.created_at - rprev.created_at < 300;
                        return <Message key={r.id} message={r} grouped={rgrouped} />;
                      })}
                    </div>
                  )}
                </div>
              )}
            </Fragment>
          );
        })}
        {typingNames.length > 0 && (
          <div className="px-4 pt-2 text-xs italic text-[var(--c-muted)]">
            {typingNames.join(", ")} {typingNames.length === 1 ? "is" : "are"} typing…
          </div>
        )}
      </div>

      {scrolled && (
        <button
          onClick={scrollToBottom}
          className="btn btn-primary absolute bottom-24 right-6 z-10 !rounded-full shadow-lg fade-in"
          title="Jump to latest"
        >
          <ArrowDown size={16} />
          {newCount > 0 ? `${newCount} new` : "Latest"}
        </button>
      )}

      <Composer view={view} dmWith={dm?.with} />
    </div>
  );
}
