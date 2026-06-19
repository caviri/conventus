import { useEffect, useState } from "react";
import { useStore } from "../store";
import { api } from "../api";
import type { Bot } from "../types";
import Avatar from "./Avatar";
import { randomProcAvatar } from "../avatar";
import {
  Shield,
  Bot as BotIcon,
  Users,
  Database,
  Plus,
  Trash2,
  Download,
  Upload,
  Power,
  Pencil,
  Check,
  X,
  Star,
  Dices,
} from "lucide-react";

type Tab = "bots" | "members" | "room";

export default function AdminPanel() {
  const [tab, setTab] = useState<Tab>("bots");
  return (
    <div className="flex h-full flex-col">
      <header className="surface flex items-center gap-3 border-b border-[var(--c-border)] px-4 py-3 pl-14 md:pl-4">
        <Shield size={18} className="text-amber-400" />
        <div className="font-semibold">Admin</div>
        <div className="ml-auto flex gap-1 overflow-x-auto md:ml-4">
          <Tabish icon={<BotIcon size={15} />} label="Bots & Assistant" active={tab === "bots"} onClick={() => setTab("bots")} />
          <Tabish icon={<Users size={15} />} label="Members" active={tab === "members"} onClick={() => setTab("members")} />
          <Tabish icon={<Database size={15} />} label="Room" active={tab === "room"} onClick={() => setTab("room")} />
        </div>
      </header>
      <div className="flex-1 overflow-y-auto p-4">
        <div className="mx-auto max-w-3xl">
          {tab === "bots" && <BotsTab />}
          {tab === "members" && <MembersTab />}
          {tab === "room" && <RoomTab />}
        </div>
      </div>
    </div>
  );
}

function Tabish({ icon, label, active, onClick }: any) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm transition ${
        active ? "bg-[var(--c-accent-soft)] text-[var(--c-text)]" : "text-[var(--c-muted)] hover:bg-[var(--c-elevated)]"
      }`}
    >
      {icon}
      {label}
    </button>
  );
}

const EMPTY_BOT = {
  name: "",
  base_url: "https://api.openai.com/v1",
  api_key: "",
  model: "gpt-4o-mini",
  model_type: "standard" as "standard" | "reasoning",
  system_prompt: "",
  trigger: "mention" as const,
  channels: [] as number[],
  avatar: "",
};

function BotsTab() {
  const bots = useStore((s) => s.bots);
  const channels = useStore((s) => s.channels);
  const refreshBots = useStore((s) => s.refreshBots);
  const refreshAgent = useStore((s) => s.refreshAgent);
  const [form, setForm] = useState({ ...EMPTY_BOT });
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState("");
  const [editId, setEditId] = useState<number | null>(null);
  const [editForm, setEditForm] = useState({
    base_url: "",
    api_key: "",
    model: "",
    model_type: "standard" as "standard" | "reasoning",
    system_prompt: "",
    trigger: "mention" as "mention" | "all",
    channels: [] as number[],
    avatar: "",
  });

  useEffect(() => {
    refreshBots();
  }, [refreshBots]);

  async function makeAssistant(bot: Bot) {
    await api.post(`/api/bots/${bot.id}/assistant`, {});
    await refreshBots();
    await refreshAgent();
  }

  async function create() {
    setError("");
    try {
      await api.post("/api/bots", form);
      setForm({ ...EMPTY_BOT });
      setShowForm(false);
      await refreshBots();
    } catch (e: any) {
      setError(e.message);
    }
  }

  async function toggle(bot: Bot) {
    await api.patch(`/api/bots/${bot.id}`, { enabled: !bot.enabled });
    await refreshBots();
  }

  async function remove(bot: Bot) {
    if (!confirm(`Delete bot ${bot.name}?`)) return;
    await api.del(`/api/bots/${bot.id}`);
    await refreshBots();
  }

  function startEdit(bot: Bot) {
    setEditId(bot.id);
    setEditForm({
      base_url: bot.base_url,
      api_key: "",
      model: bot.model,
      model_type: bot.model_type,
      system_prompt: bot.system_prompt,
      trigger: bot.trigger,
      channels: bot.channels,
      avatar: bot.avatar,
    });
  }

  async function saveEdit(id: number) {
    const payload: any = { ...editForm };
    if (!payload.api_key) delete payload.api_key; // empty = keep existing
    await api.patch(`/api/bots/${id}`, payload);
    setEditId(null);
    await refreshBots();
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-[var(--c-muted)]">
          Bots are OpenAI-compatible endpoints that reply in channels. The one
          marked <Star size={12} className="inline -mt-0.5 fill-amber-400 text-amber-400" />{" "}
          <b>Assistant</b> (the Gardener) also powers private conversations,
          live-doc completion and kanban fill.
        </p>
        <button className="btn btn-primary shrink-0" onClick={() => setShowForm((v) => !v)}>
          <Plus size={16} /> New bot
        </button>
      </div>

      {showForm && (
        <div className="card space-y-3 p-4 fade-in">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Name">
              <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="assistant" />
            </Field>
            <Field label="Model">
              <input className="input" value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })} />
            </Field>
            <Field label="Model type">
              <select className="input" value={form.model_type} onChange={(e) => setForm({ ...form, model_type: e.target.value as "standard" | "reasoning" })}>
                <option value="standard">Standard</option>
                <option value="reasoning">Reasoning (e.g. gpt-oss, o-series)</option>
              </select>
            </Field>
            <Field label="Avatar (generated by default — emoji or image URL)">
              <div className="flex items-center gap-2">
                <Avatar avatar={form.avatar} name={form.name || "bot"} color="#10b981" className="h-9 w-9" />
                <input className="input" value={form.avatar} onChange={(e) => setForm({ ...form, avatar: e.target.value })} placeholder="🤖 or blank" />
                <button className="btn shrink-0" title="Generate an icon" onClick={() => setForm({ ...form, avatar: randomProcAvatar() })}>
                  <Dices size={15} />
                </button>
              </div>
            </Field>
            <Field label="Base URL (OpenAI-compatible)">
              <input className="input" value={form.base_url} onChange={(e) => setForm({ ...form, base_url: e.target.value })} />
            </Field>
            <Field label="API key">
              <input className="input" type="password" value={form.api_key} onChange={(e) => setForm({ ...form, api_key: e.target.value })} />
            </Field>
          </div>
          <Field label="System prompt">
            <textarea className="input h-20 resize-y" value={form.system_prompt} onChange={(e) => setForm({ ...form, system_prompt: e.target.value })} />
          </Field>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Trigger">
              <select className="input" value={form.trigger} onChange={(e) => setForm({ ...form, trigger: e.target.value as any })}>
                <option value="mention">On @mention</option>
                <option value="all">On every message</option>
              </select>
            </Field>
            <Field label="Channels (none = all)">
              <select
                multiple
                className="input h-20"
                value={form.channels.map(String)}
                onChange={(e) =>
                  setForm({
                    ...form,
                    channels: Array.from(e.target.selectedOptions, (o) => Number(o.value)),
                  })
                }
              >
                {channels.map((c) => (
                  <option key={c.id} value={c.id}>
                    #{c.name}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          {error && <p className="text-sm text-red-300">{error}</p>}
          <div className="flex gap-2">
            <button className="btn btn-primary" onClick={create}>
              Create bot
            </button>
            <button className="btn" onClick={() => setShowForm(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className="space-y-2">
        {bots.map((b) => (
          <div key={b.id} className="card p-3">
            <div className="flex items-center gap-3">
              <Avatar avatar={b.avatar} name={b.name} color={b.color} className="h-9 w-9" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 font-medium">
                  {b.name}
                  {b.is_assistant && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-amber-400/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-400">
                      <Star size={10} className="fill-amber-400" /> Assistant
                    </span>
                  )}
                </div>
                <div className="truncate text-xs text-[var(--c-muted)]">
                  {b.model}
                  {b.model_type === "reasoning" ? " (reasoning)" : ""} ·{" "}
                  {b.trigger === "all" ? "every message" : "@mention"} ·{" "}
                  {b.channels.length ? `${b.channels.length} channel(s)` : "all channels"}
                </div>
              </div>
              {!b.is_assistant && (
                <button className="btn !px-2 text-[var(--c-muted)] hover:text-amber-400" onClick={() => makeAssistant(b)} title="Make this the room Assistant">
                  <Star size={16} />
                </button>
              )}
              <button className={`btn !px-2 ${b.enabled ? "text-emerald-400" : "text-[var(--c-muted)]"}`} onClick={() => toggle(b)} title={b.enabled ? "Enabled" : "Disabled"}>
                <Power size={16} />
              </button>
              <button className="btn !px-2 text-[var(--c-muted)] hover:text-[var(--c-text)]" onClick={() => (editId === b.id ? setEditId(null) : startEdit(b))} title="Edit">
                <Pencil size={15} />
              </button>
              <button className="btn !px-2 text-[var(--c-muted)] hover:text-red-300" onClick={() => remove(b)}>
                <Trash2 size={16} />
              </button>
            </div>

            {editId === b.id && (
              <div className="mt-3 space-y-3 border-t border-[var(--c-border)] pt-3 fade-in">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <Field label="Model">
                    <input className="input" value={editForm.model} onChange={(e) => setEditForm({ ...editForm, model: e.target.value })} />
                  </Field>
                  <Field label="Model type">
                    <select className="input" value={editForm.model_type} onChange={(e) => setEditForm({ ...editForm, model_type: e.target.value as "standard" | "reasoning" })}>
                      <option value="standard">Standard</option>
                      <option value="reasoning">Reasoning (e.g. gpt-oss, o-series)</option>
                    </select>
                  </Field>
                  <Field label="Avatar (generated by default — emoji or image URL)">
                    <div className="flex items-center gap-2">
                      <Avatar avatar={editForm.avatar} name={b.name} color={b.color} className="h-9 w-9" />
                      <input className="input" value={editForm.avatar} onChange={(e) => setEditForm({ ...editForm, avatar: e.target.value })} placeholder="🤖 or blank" />
                      <button className="btn shrink-0" title="Generate an icon" onClick={() => setEditForm({ ...editForm, avatar: randomProcAvatar() })}>
                        <Dices size={15} />
                      </button>
                    </div>
                  </Field>
                  <Field label="Base URL">
                    <input className="input" value={editForm.base_url} onChange={(e) => setEditForm({ ...editForm, base_url: e.target.value })} />
                  </Field>
                  <Field label="API key (leave blank to keep)">
                    <input className="input" type="password" value={editForm.api_key} placeholder="••••••" onChange={(e) => setEditForm({ ...editForm, api_key: e.target.value })} />
                  </Field>
                </div>
                <Field label="System prompt">
                  <textarea className="input h-20 resize-y" value={editForm.system_prompt} onChange={(e) => setEditForm({ ...editForm, system_prompt: e.target.value })} />
                </Field>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <Field label="Trigger">
                    <select className="input" value={editForm.trigger} onChange={(e) => setEditForm({ ...editForm, trigger: e.target.value as any })}>
                      <option value="mention">On @mention</option>
                      <option value="all">On every message</option>
                    </select>
                  </Field>
                  <Field label="Channels (none = all)">
                    <select
                      multiple
                      className="input h-20"
                      value={editForm.channels.map(String)}
                      onChange={(e) =>
                        setEditForm({
                          ...editForm,
                          channels: Array.from(e.target.selectedOptions, (o) => Number(o.value)),
                        })
                      }
                    >
                      {channels.map((c) => (
                        <option key={c.id} value={c.id}>
                          #{c.name}
                        </option>
                      ))}
                    </select>
                  </Field>
                </div>
                <div className="flex gap-2">
                  <button className="btn btn-primary" onClick={() => saveEdit(b.id)}>
                    <Check size={15} /> Save
                  </button>
                  <button className="btn" onClick={() => setEditId(null)}>
                    <X size={15} /> Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}
        {bots.length === 0 && <p className="text-sm text-[var(--c-muted)]">No bots yet.</p>}
      </div>
    </div>
  );
}

function MembersTab() {
  const members = useStore((s) => s.members);
  const refreshMembers = useStore((s) => s.refreshMembers);
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [isAdmin, setIsAdmin] = useState(false);
  const [msg, setMsg] = useState("");

  useEffect(() => {
    refreshMembers();
  }, [refreshMembers]);

  async function reserve() {
    setMsg("");
    try {
      await api.post("/api/admin/reserve", { name: name.trim(), password, is_admin: isAdmin });
      setMsg(`Reserved “${name}”.`);
      setName("");
      setPassword("");
      setIsAdmin(false);
      await refreshMembers();
    } catch (e: any) {
      setMsg(e.message);
    }
  }

  async function remove(n: string) {
    if (!confirm(`Remove ${n}?`)) return;
    await api.del(`/api/admin/members/${encodeURIComponent(n)}`);
    await refreshMembers();
  }

  return (
    <div className="space-y-4">
      <div className="card space-y-3 p-4">
        <h3 className="font-semibold">Reserve a name</h3>
        <p className="text-sm text-[var(--c-muted)]">
          Reserved names require their own password at login — useful for handing out
          identities ahead of time.
        </p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <input className="input" placeholder="name" value={name} onChange={(e) => setName(e.target.value)} />
          <input className="input" type="password" placeholder="password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={isAdmin} onChange={(e) => setIsAdmin(e.target.checked)} />
          Grant admin
        </label>
        <div className="flex items-center gap-3">
          <button className="btn btn-primary" onClick={reserve} disabled={!name.trim() || !password}>
            Reserve
          </button>
          {msg && <span className="text-sm text-[var(--c-muted)]">{msg}</span>}
        </div>
      </div>

      <div className="space-y-2">
        {members.map((m) => (
          <div key={m.name} className="card flex items-center gap-3 p-3">
            <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: m.color }} />
            <span className="font-medium">{m.name}</span>
            {m.is_admin && <Shield size={13} className="text-amber-400" />}
            {m.reserved && <span className="rounded bg-[var(--c-elevated)] px-1.5 text-xs text-[var(--c-muted)]">reserved</span>}
            <span className="ml-auto text-xs text-[var(--c-muted)]">{m.online ? "online" : "offline"}</span>
            <button className="btn !px-2 text-[var(--c-muted)] hover:text-red-300" onClick={() => remove(m.name)}>
              <Trash2 size={15} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

function RoomTab() {
  const [importing, setImporting] = useState(false);
  const [msg, setMsg] = useState("");

  async function doExport() {
    const blob = await api.exportRoom();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "conventus-export.zip";
    a.click();
    URL.revokeObjectURL(url);
  }

  async function doImport(file: File | undefined) {
    if (!file) return;
    if (!confirm("Importing replaces the entire current room. Continue?")) return;
    setImporting(true);
    setMsg("");
    try {
      await api.importRoom(file);
      setMsg("Imported. Reloading…");
    } catch (e: any) {
      setMsg(e.message);
      setImporting(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="card space-y-3 p-4">
        <h3 className="font-semibold">Export / Import</h3>
        <p className="text-sm text-[var(--c-muted)]">
          Snapshot the whole room (messages, files, bots, members) to a single zip,
          then rehydrate it later — perfect for ephemeral rooms.
        </p>
        <div className="flex flex-wrap gap-2">
          <button className="btn btn-primary" onClick={doExport}>
            <Download size={16} /> Export room
          </button>
          <label className="btn cursor-pointer">
            <Upload size={16} /> {importing ? "Importing…" : "Import room"}
            <input type="file" accept=".zip" className="hidden" onChange={(e) => doImport(e.target.files?.[0])} />
          </label>
        </div>
        {msg && <p className="text-sm text-[var(--c-muted)]">{msg}</p>}
      </div>

      <div className="card space-y-2 p-4">
        <h3 className="font-semibold">Automation API</h3>
        <p className="text-sm text-[var(--c-muted)]">
          Every endpoint is protected by your session token. Get one via{" "}
          <code>POST /api/auth/login</code> then call, e.g.:
        </p>
        <pre className="msg-content overflow-x-auto rounded-lg bg-[var(--c-bg)] p-3 text-xs">
{`curl -s $URL/api/auth/login -H 'content-type: application/json' \\
  -d '{"password":"<room>","name":"poster"}' | jq -r .token

curl $URL/api/channels/1/messages -X POST \\
  -H "Authorization: Bearer $TOKEN" \\
  -H 'content-type: application/json' \\
  -d '{"content":"Hello from the API 🚀"}'`}
        </pre>
      </div>
    </div>
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
