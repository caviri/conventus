import { create } from "zustand";
import { api, getToken, setToken } from "./api";
import { notifyMention } from "./notifications";
import type {
  AgentConfig,
  Board,
  Bot,
  Channel,
  Conversation,
  DM,
  FileItem,
  Folder,
  Member,
  Message,
  User,
  View,
} from "./types";

export function viewKey(view: View): string {
  if (view.type === "channel") return `channel:${view.id}`;
  if (view.type === "dm") return `dm:${view.id}`;
  if (view.type === "conversation") return `conversation:${view.id}`;
  if (view.type === "canvas") return `canvas:${view.id}`;
  if (view.type === "whiteboard") return `whiteboard:${view.id}`;
  if (view.type === "kanban") return `kanban:${view.id}`;
  if (view.type === "room") return `room:${view.id}`;
  return view.type;
}

interface TypingEntry {
  name: string;
  at: number;
}

interface State {
  ready: boolean;
  user: User | null;
  roomName: string;
  channels: Channel[];
  dms: DM[];
  conversations: Conversation[];
  agent: AgentConfig | null;
  members: Member[];
  online: string[];
  bots: Bot[];
  boards: Board[];
  folders: Folder[];
  files: FileItem[];
  view: View;
  messages: Record<string, Message[]>;
  unread: Record<string, number>;
  typing: Record<string, TypingEntry[]>;
  connected: boolean;
  replyTarget: Message | null;
  searchOpen: boolean;
  lightbox: { url: string; name?: string } | null;

  bootstrap: () => Promise<void>;
  login: (token: string, user: User) => Promise<void>;
  logout: () => void;
  setView: (view: View) => Promise<void>;
  loadMessages: (view: View) => Promise<void>;
  refreshChannels: () => Promise<void>;
  refreshDms: () => Promise<void>;
  refreshAgent: () => Promise<void>;
  refreshConversations: () => Promise<void>;
  newConversation: (title?: string) => Promise<void>;
  openConversation: (id: number) => Promise<void>;
  openAgentChat: () => Promise<void>;
  renameConversation: (id: number, title: string) => Promise<void>;
  setConversationPrompt: (id: number, systemPrompt: string) => Promise<void>;
  deleteConversation: (id: number) => Promise<void>;
  refreshMembers: () => Promise<void>;
  refreshBots: () => Promise<void>;
  refreshBoards: () => Promise<void>;
  refreshFolders: () => Promise<void>;
  moveToFolder: (kind: "channel" | "board", id: number, folderId: number | null) => Promise<void>;
  refreshFiles: () => Promise<void>;
  openDm: (name: string) => Promise<void>;
  addLocalMessage: (content: string, kind?: "system" | "bot") => void;
  setReplyTarget: (m: Message | null) => void;
  setSearchOpen: (v: boolean) => void;
  setLightbox: (v: { url: string; name?: string } | null) => void;
  handleEvent: (event: string, data: any) => void;
  setConnected: (v: boolean) => void;
}

// Monotonically decreasing ids for ephemeral, client-only messages so they
// never collide with server message ids (which are positive).
let _localSeq = -1;

export const useStore = create<State>((set, get) => ({
  ready: false,
  user: null,
  roomName: "Conventus",
  channels: [],
  dms: [],
  conversations: [],
  agent: null,
  members: [],
  online: [],
  bots: [],
  boards: [],
  folders: [],
  files: [],
  view: { type: "channel", id: 0 },
  messages: {},
  unread: {},
  typing: {},
  connected: false,
  replyTarget: null,
  searchOpen: false,
  lightbox: null,

  async bootstrap() {
    const cfg = await api.get<{ room_name: string }>("/api/auth/config");
    set({ roomName: cfg.room_name });
    if (!getToken()) {
      set({ ready: true });
      return;
    }
    try {
      const user = await api.get<User>("/api/auth/me");
      set({ user });
      await Promise.all([
        get().refreshChannels(),
        get().refreshDms(),
        get().refreshConversations(),
        get().refreshAgent(),
        get().refreshMembers(),
        get().refreshBoards(),
        get().refreshFolders(),
      ]);
      const first = get().channels[0];
      if (first) await get().setView({ type: "channel", id: first.id });
    } catch {
      setToken(null);
    } finally {
      set({ ready: true });
    }
  },

  async login(token, user) {
    setToken(token);
    set({ user });
    await Promise.all([
      get().refreshChannels(),
      get().refreshDms(),
      get().refreshConversations(),
      get().refreshAgent(),
      get().refreshMembers(),
      get().refreshBoards(),
      get().refreshFolders(),
    ]);
    const first = get().channels[0];
    if (first) await get().setView({ type: "channel", id: first.id });
  },

  logout() {
    setToken(null);
    set({
      user: null,
      messages: {},
      unread: {},
      dms: [],
      conversations: [],
      view: { type: "channel", id: 0 },
    });
  },

  async setView(view) {
    set((s) => ({
      view,
      unread: { ...s.unread, [viewKey(view)]: 0 },
      replyTarget: null,
    }));
    if (view.type === "channel" || view.type === "dm" || view.type === "conversation") {
      await get().loadMessages(view);
    }
    if (view.type === "drive") await get().refreshFiles();
    if (view.type === "admin") await get().refreshBots();
  },

  async loadMessages(view) {
    const key = viewKey(view);
    const id = (view as any).id;
    const base =
      view.type === "channel"
        ? `/api/channels/${id}/messages`
        : view.type === "conversation"
        ? `/api/conversations/${id}/messages`
        : `/api/dms/${id}/messages`;
    const msgs = await api.get<Message[]>(base);
    set((s) => ({ messages: { ...s.messages, [key]: msgs } }));
  },

  async refreshChannels() {
    set({ channels: await api.get<Channel[]>("/api/channels") });
  },
  async refreshDms() {
    set({ dms: await api.get<DM[]>("/api/dms") });
  },
  async refreshAgent() {
    try {
      set({ agent: await api.get<AgentConfig>("/api/agent") });
    } catch {
      set({ agent: null });
    }
  },
  async refreshConversations() {
    set({ conversations: await api.get<Conversation[]>("/api/conversations") });
  },
  async newConversation(title) {
    const c = await api.post<Conversation>("/api/conversations", title ? { title } : {});
    await get().refreshConversations();
    await get().setView({ type: "conversation", id: c.id });
  },
  async openConversation(id) {
    await get().setView({ type: "conversation", id });
  },
  // Open the single ongoing chat with the Assistant — reuse the most recent
  // conversation instead of spawning a new one each time; create one only if
  // none exists yet.
  async openAgentChat() {
    await get().refreshConversations();
    const existing = get().conversations[0];
    if (existing) await get().setView({ type: "conversation", id: existing.id });
    else await get().newConversation();
  },
  async renameConversation(id, title) {
    await api.patch(`/api/conversations/${id}`, { title });
    await get().refreshConversations();
  },
  async setConversationPrompt(id, systemPrompt) {
    await api.patch(`/api/conversations/${id}`, { system_prompt: systemPrompt });
    await get().refreshConversations();
  },
  async deleteConversation(id) {
    await api.del(`/api/conversations/${id}`);
    const wasViewing = get().view.type === "conversation" && (get().view as any).id === id;
    await get().refreshConversations();
    if (wasViewing) {
      const first = get().channels[0];
      if (first) await get().setView({ type: "channel", id: first.id });
    }
  },
  async refreshMembers() {
    set({ members: await api.get<Member[]>("/api/members") });
  },
  async refreshBots() {
    set({ bots: await api.get<Bot[]>("/api/bots") });
  },
  async refreshBoards() {
    set({ boards: await api.get<Board[]>("/api/boards") });
  },
  async refreshFolders() {
    set({ folders: await api.get<Folder[]>("/api/folders") });
  },
  async moveToFolder(kind, id, folderId) {
    await api.post("/api/folders/move", { kind, id, folder_id: folderId });
    // The server broadcasts folder.move; refresh locally too for snappiness.
    await Promise.all([get().refreshChannels(), get().refreshBoards()]);
  },
  async refreshFiles() {
    set({ files: await api.get<FileItem[]>("/api/files") });
  },

  async openDm(name) {
    const dm = await api.post<DM>("/api/dms", { with: name });
    await get().refreshDms();
    await get().setView({ type: "dm", id: dm.id });
  },

  addLocalMessage(content, kind = "system") {
    set((s) => {
      const key = viewKey(s.view);
      const existing = s.messages[key];
      if (!existing) return {};
      const msg: Message = {
        id: _localSeq--,
        channel_id: s.view.type === "channel" ? s.view.id : null,
        dm_id: s.view.type === "dm" ? s.view.id : null,
        conversation_id:
          s.view.type === "conversation" ? s.view.id : null,
        author: kind === "bot" ? "Conventus" : "system",
        kind,
        content,
        attachments: [],
        previews: [],
        reactions: [],
        reply_to: null,
        reply_preview: null,
        pinned: false,
        created_at: Date.now() / 1000,
        edited_at: null,
        color: "#8b5cf6",
        avatar: kind === "bot" ? "✨" : null,
      };
      return { messages: { ...s.messages, [key]: [...existing, msg] } };
    });
  },

  setReplyTarget(m) {
    set({ replyTarget: m });
  },

  setSearchOpen(v) {
    set({ searchOpen: v });
  },

  setLightbox(v) {
    set({ lightbox: v });
  },

  setConnected(v) {
    set({ connected: v });
  },

  handleEvent(event, data) {
    const state = get();
    switch (event) {
      case "presence": {
        const online: string[] = data.online;
        const known = new Set(state.members.map((m) => m.name));
        set((s) => ({
          online,
          members: s.members.map((m) => ({
            ...m,
            online: online.includes(m.name),
          })),
          // Keep the presence dot beside each DM live, not just on new messages.
          dms: s.dms.map((d) => ({ ...d, online: online.includes(d.with) })),
        }));
        // Only hit the network if someone we don't know yet came online.
        if (online.some((n) => !known.has(n))) get().refreshMembers();
        break;
      }
      case "message":
      case "message.update": {
        const msg = data as Message;
        const key = msg.channel_id
          ? `channel:${msg.channel_id}`
          : msg.conversation_id
          ? `conversation:${msg.conversation_id}`
          : `dm:${msg.dm_id}`;
        set((s) => {
          const existing = s.messages[key];
          let next = existing;
          if (existing) {
            const idx = existing.findIndex((m) => m.id === msg.id);
            next =
              idx >= 0
                ? existing.map((m) => (m.id === msg.id ? msg : m))
                : [...existing, msg];
          }
          const isCurrent = viewKey(s.view) === key;
          const unread =
            event === "message" && !isCurrent && msg.author !== s.user?.name
              ? { ...s.unread, [key]: (s.unread[key] || 0) + 1 }
              : s.unread;
          return {
            messages: next ? { ...s.messages, [key]: next } : s.messages,
            unread,
          };
        });
        if (msg.dm_id) get().refreshDms();
        if (msg.conversation_id) get().refreshConversations();
        break;
      }
      case "message.delete": {
        const key = data.channel_id
          ? `channel:${data.channel_id}`
          : data.conversation_id
          ? `conversation:${data.conversation_id}`
          : `dm:${data.dm_id}`;
        set((s) => {
          const existing = s.messages[key];
          if (!existing) return {};
          return {
            messages: {
              ...s.messages,
              [key]: existing.filter((m) => m.id !== data.id),
            },
          };
        });
        break;
      }
      case "channel.create":
      case "channel.update":
        get().refreshChannels();
        break;
      case "channel.delete":
        get().refreshChannels();
        if (
          state.view.type === "channel" &&
          state.view.id === data.id &&
          state.channels[0]
        ) {
          get().setView({ type: "channel", id: state.channels[0].id });
        }
        break;
      case "mention": {
        const where = data.channel_name ? `#${data.channel_name}` : "a DM";
        notifyMention(data.author, where, data.excerpt || "");
        break;
      }
      case "dm.open":
        get().refreshDms();
        break;
      case "conversation.update":
        get().refreshConversations();
        break;
      case "board.create":
      case "board.update":
      case "board.delete":
        get().refreshBoards();
        break;
      case "folder.create":
      case "folder.update":
      case "folder.delete":
      case "folder.move":
        get().refreshFolders();
        get().refreshChannels();
        get().refreshBoards();
        break;
      case "member.remove":
      case "member.update":
        get().refreshMembers();
        break;
      case "typing": {
        const key = data.channel_id
          ? `channel:${data.channel_id}`
          : data.conversation_id
          ? `conversation:${data.conversation_id}`
          : `dm:${data.dm_id}`;
        if (data.name === state.user?.name) break;
        set((s) => {
          const list = (s.typing[key] || []).filter(
            (t) => t.name !== data.name
          );
          return {
            typing: { ...s.typing, [key]: [...list, { name: data.name, at: Date.now() }] },
          };
        });
        break;
      }
      case "room.reload":
        window.location.reload();
        break;
    }
  },
}));
