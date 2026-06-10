export interface User {
  name: string;
  is_admin: boolean;
  color: string;
}

export interface Member extends User {
  online: boolean;
  reserved: boolean;
  status: string;
  avatar: string;
  last_seen: number;
}

export interface Channel {
  id: number;
  name: string;
  topic: string;
  is_default: boolean;
  folder_id: number | null;
}

export interface Folder {
  id: number;
  name: string;
  position: number;
}

export interface Attachment {
  id: string;
  name: string;
  mime: string;
  size: number;
  url: string;
}

export interface LinkPreview {
  url: string;
  type: "link" | "image" | "video";
  title?: string;
  description?: string;
  image?: string;
  video?: string;
  mime?: string;
  site?: string;
}

export interface Reaction {
  emoji: string;
  count: number;
  users: string[];
}

export interface ReplyPreview {
  id: number;
  author: string;
  kind: string;
  content: string;
}

export interface Message {
  id: number;
  channel_id: number | null;
  dm_id: number | null;
  author: string;
  kind: "text" | "system" | "bot";
  content: string;
  attachments: Attachment[];
  previews: LinkPreview[];
  reactions: Reaction[];
  reply_to: number | null;
  reply_preview: ReplyPreview | null;
  pinned: boolean;
  created_at: number;
  edited_at: number | null;
  color: string;
  avatar: string | null;
}

export interface DM {
  id: number;
  with: string;
  online?: boolean;
  last?: Message | null;
}

export interface FileItem {
  id: string;
  name: string;
  mime: string;
  size: number;
  uploaded_by: string;
  created_at: number;
  url: string;
}

export interface Bot {
  id: number;
  name: string;
  base_url: string;
  api_key: string;
  model: string;
  system_prompt: string;
  trigger: "mention" | "all";
  channels: number[];
  color: string;
  avatar: string;
  enabled: boolean;
}

export type SearchLocation =
  | { type: "channel"; id: number; name: string }
  | { type: "dm"; id: number; with: string };

export interface SearchResult extends Message {
  location: SearchLocation;
}

export type BoardKind = "canvas" | "whiteboard" | "kanban";

export interface Board {
  id: number;
  kind: BoardKind;
  name: string;
  doc: string;
  folder_id: number | null;
}

export type View =
  | { type: "channel"; id: number }
  | { type: "dm"; id: number }
  | { type: "drive" }
  | { type: "canvas"; id: number }
  | { type: "whiteboard"; id: number }
  | { type: "kanban"; id: number }
  | { type: "settings" }
  | { type: "admin" };
