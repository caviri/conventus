import { useEffect, useState } from "react";
import { useStore } from "../store";
import { api } from "../api";
import type { AgentConfig } from "../types";
import { Sparkles, Save, Trash2, Plus, Pencil, Check, X } from "lucide-react";

// The Assistant config form (admin) + the signed-in user's conversation list.
export default function AssistantSettings() {
  const user = useStore((s) => s.user);
  const agent = useStore((s) => s.agent);
  const refreshAgent = useStore((s) => s.refreshAgent);
  const conversations = useStore((s) => s.conversations);
  const newConversation = useStore((s) => s.newConversation);
  const openConversation = useStore((s) => s.openConversation);
  const renameConversation = useStore((s) => s.renameConversation);
  const setConversationPrompt = useStore((s) => s.setConversationPrompt);
  const deleteConversation = useStore((s) => s.deleteConversation);

  const [form, setForm] = useState<Omit<AgentConfig, "api_key">>({
    name: "Assistant",
    base_url: "https://api.openai.com/v1",
    model: "gpt-4o-mini",
    model_type: "standard",
    system_prompt: "",
    color: "#8b5cf6",
    avatar: "✨",
    enabled: false,
  });
  const [apiKey, setApiKey] = useState(""); // blank = keep existing
  const [saved, setSaved] = useState(false);
  const [editPrompt, setEditPrompt] = useState<number | null>(null);
  const [promptDraft, setPromptDraft] = useState("");

  useEffect(() => {
    if (!agent) return;
    setForm({
      name: agent.name,
      base_url: agent.base_url,
      model: agent.model,
      model_type: agent.model_type,
      system_prompt: agent.system_prompt,
      color: agent.color,
      avatar: agent.avatar,
      enabled: agent.enabled,
    });
  }, [agent]);

  const keySet = agent?.api_key === "•••";

  async function save() {
    const payload: Record<string, unknown> = { ...form };
    if (apiKey) payload.api_key = apiKey; // omit to keep the stored key
    await api.patch("/api/agent", payload);
    setApiKey("");
    await refreshAgent();
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  }

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

      {user?.is_admin ? (
        <>
          <p className="mb-3 text-sm text-[var(--c-muted)]">
            Point the Assistant at any OpenAI-compatible endpoint. It powers your
            private conversations, replies inline when @mentioned in a channel,
            completes the live document, and fills kanban cards.
          </p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Name (used for @mentions)">
              <input
                className="input"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </Field>
            <Field label="Model">
              <input
                className="input"
                value={form.model}
                onChange={(e) => setForm({ ...form, model: e.target.value })}
              />
            </Field>
            <Field label="Model type">
              <select
                className="input"
                value={form.model_type}
                onChange={(e) =>
                  setForm({
                    ...form,
                    model_type: e.target.value as "standard" | "reasoning",
                  })
                }
              >
                <option value="standard">Standard</option>
                <option value="reasoning">Reasoning (e.g. gpt-oss, o-series)</option>
              </select>
            </Field>
            <Field label="Base URL (OpenAI-compatible)">
              <input
                className="input"
                value={form.base_url}
                onChange={(e) => setForm({ ...form, base_url: e.target.value })}
              />
            </Field>
            <Field label={`API key${keySet ? " (leave blank to keep)" : ""}`}>
              <input
                className="input"
                type="password"
                value={apiKey}
                placeholder={keySet ? "••••••" : "sk-…"}
                onChange={(e) => setApiKey(e.target.value)}
              />
            </Field>
            <Field label="Avatar (emoji or image URL)">
              <input
                className="input"
                value={form.avatar}
                onChange={(e) => setForm({ ...form, avatar: e.target.value })}
              />
            </Field>
            <Field label="Accent colour">
              <input
                className="input h-9 p-1"
                type="color"
                value={form.color}
                onChange={(e) => setForm({ ...form, color: e.target.value })}
              />
            </Field>
          </div>
          <div className="mt-3">
            <Field label="Base system prompt / context">
              <textarea
                className="input h-24 resize-y"
                value={form.system_prompt}
                placeholder="You are a helpful assistant for this room…"
                onChange={(e) => setForm({ ...form, system_prompt: e.target.value })}
              />
            </Field>
          </div>
          <label className="mt-3 flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={form.enabled}
              onChange={(e) => setForm({ ...form, enabled: e.target.checked })}
            />
            Enabled
          </label>
          <div className="mt-3 flex items-center gap-2">
            <button className="btn btn-primary" onClick={save}>
              <Save size={16} /> Save
            </button>
            {saved && <span className="text-sm text-emerald-400 fade-in">Saved ✓</span>}
          </div>
        </>
      ) : (
        <p className="mb-3 text-sm text-[var(--c-muted)]">
          {agent?.enabled
            ? `The Assistant (${agent.name}) is ready. Start a conversation below, or @mention it in a channel.`
            : "The Assistant isn't enabled yet — ask an admin to set it up."}
        </p>
      )}

      {/* Conversations */}
      <div className="mt-5 border-t border-[var(--c-border)] pt-4">
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
                    <button
                      className="btn !py-1 text-xs"
                      onClick={() => setEditPrompt(null)}
                    >
                      <X size={13} /> Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-[var(--c-muted)]">{label}</span>
      {children}
    </label>
  );
}
