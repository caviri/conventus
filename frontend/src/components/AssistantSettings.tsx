import { useState } from "react";
import { useStore } from "../store";
import { Sparkles, Trash2, Plus, Pencil, Check, X } from "lucide-react";

// The signed-in user's conversation list. The Assistant's *configuration* lives
// in the Admin panel; this is the per-user part shown in Settings.
export default function AssistantSettings() {
  const agent = useStore((s) => s.agent);
  const conversations = useStore((s) => s.conversations);
  const newConversation = useStore((s) => s.newConversation);
  const openConversation = useStore((s) => s.openConversation);
  const renameConversation = useStore((s) => s.renameConversation);
  const setConversationPrompt = useStore((s) => s.setConversationPrompt);
  const deleteConversation = useStore((s) => s.deleteConversation);

  const [editPrompt, setEditPrompt] = useState<number | null>(null);
  const [promptDraft, setPromptDraft] = useState("");

  return (
    <section className="card p-4">
      <div className="mb-2 flex items-center gap-2">
        <Sparkles size={16} className="text-[var(--c-accent)]" />
        <h2 className="font-semibold">Assistant</h2>
        {agent && (
          <span
            className={`ml-auto rounded-full px-2 py-0.5 text-xs ${
              agent.enabled
                ? "bg-[var(--c-accent-soft)] text-[var(--c-accent)]"
                : "bg-[var(--c-elevated)] text-[var(--c-muted)]"
            }`}
          >
            {agent.enabled ? "Enabled" : "Disabled"}
          </span>
        )}
      </div>
      <p className="mb-4 text-sm text-[var(--c-muted)]">
        {agent?.enabled
          ? `Chat privately with ${agent.name}, or @mention it in a channel. Admins configure it in the Admin panel.`
          : "The Assistant isn't enabled yet — an admin can set it up in the Admin panel."}
      </p>

      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-sm font-semibold">Your conversations</h3>
        <button className="btn !py-1.5 text-xs" onClick={() => newConversation()}>
          <Plus size={14} /> New
        </button>
      </div>
      {conversations.length === 0 && (
        <p className="text-sm text-[var(--c-muted)]">No conversations yet.</p>
      )}
      <div className="space-y-1">
        {conversations.map((c) => (
          <div key={c.id} className="rounded-lg border border-[var(--c-border)] p-2">
            <div className="flex items-center gap-2">
              <Sparkles size={14} style={{ color: agent?.color || "#8b5cf6" }} />
              <button
                className="min-w-0 flex-1 truncate text-left text-sm hover:underline"
                onClick={() => openConversation(c.id)}
              >
                {c.title}
              </button>
              <button
                className="text-[var(--c-muted)] hover:text-[var(--c-text)]"
                title="Rename"
                onClick={async () => {
                  const next = window.prompt("Rename conversation", c.title)?.trim();
                  if (next && next !== c.title) await renameConversation(c.id, next);
                }}
              >
                <Pencil size={13} />
              </button>
              <button
                className="text-[var(--c-muted)] hover:text-[var(--c-text)]"
                title="Edit system prompt for this thread"
                onClick={() => {
                  setEditPrompt(editPrompt === c.id ? null : c.id);
                  setPromptDraft(c.system_prompt);
                }}
              >
                <Sparkles size={13} />
              </button>
              <button
                className="text-[var(--c-muted)] hover:text-red-300"
                title="Delete"
                onClick={() => {
                  if (window.confirm(`Delete “${c.title}”?`)) deleteConversation(c.id);
                }}
              >
                <Trash2 size={13} />
              </button>
            </div>
            {editPrompt === c.id && (
              <div className="mt-2 fade-in">
                <textarea
                  className="input h-20 resize-y text-sm"
                  value={promptDraft}
                  placeholder="Override the base system prompt for this thread…"
                  onChange={(e) => setPromptDraft(e.target.value)}
                />
                <div className="mt-1.5 flex gap-2">
                  <button
                    className="btn btn-primary !py-1 text-xs"
                    onClick={async () => {
                      await setConversationPrompt(c.id, promptDraft);
                      setEditPrompt(null);
                    }}
                  >
                    <Check size={13} /> Save
                  </button>
                  <button className="btn !py-1 text-xs" onClick={() => setEditPrompt(null)}>
                    <X size={13} /> Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
