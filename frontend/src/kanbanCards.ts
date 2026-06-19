// Generate kanban cards from a prompt (server-side, pydantic-validated) and
// insert them into a board's shared Yjs document. Used both by the in-board
// "Generate cards" modal and the `/kanban` chat command.
import * as Y from "yjs";
import { api } from "./api";
import { createCollab } from "./collab";
import type { Board } from "./types";

export interface CardDraft {
  text: string;
  tags: string;
  due: string;
  assignee: string;
}

function uid(): string {
  return (
    (typeof crypto !== "undefined" && crypto.randomUUID && crypto.randomUUID()) ||
    Date.now().toString(36) + Math.random().toString(36).slice(2)
  );
}

/** Ask the Assistant for validated card drafts. */
export async function generateCards(
  prompt: string,
  members: string[],
  count?: number
): Promise<CardDraft[]> {
  const res = await api.post<{ cards: CardDraft[] }>("/api/agent/cards", {
    prompt,
    members,
    count,
  });
  return res.cards || [];
}

/** Insert drafts as cards into the given Yjs board doc. Falls back to creating
 * a "To do" column when the board has none, or uses the first column. */
export function insertCardDrafts(
  doc: Y.Doc,
  columns: Y.Array<Y.Map<any>>,
  cards: Y.Array<Y.Map<any>>,
  drafts: CardDraft[],
  colId?: string
): number {
  let inserted = 0;
  doc.transact(() => {
    let target = colId;
    if (!target) {
      if (columns.length === 0) {
        const col = new Y.Map();
        col.set("id", uid());
        col.set("title", "To do");
        columns.push([col]);
        target = col.get("id") as string;
      } else {
        target = columns.get(0).get("id") as string;
      }
    }
    for (const d of drafts) {
      if (!d.text?.trim()) continue;
      const m = new Y.Map();
      m.set("id", uid());
      m.set("col", target);
      m.set("text", d.text);
      if (d.tags) m.set("tags", d.tags);
      if (d.due) m.set("due", d.due);
      if (d.assignee) m.set("assignee", d.assignee);
      cards.push([m]);
      inserted++;
    }
  });
  return inserted;
}

/** End-to-end for the chat command: generate, open the board doc, sync, insert,
 * then flush + close. Returns how many cards were added. */
export async function generateAndApplyToBoard(
  board: Board,
  prompt: string,
  members: string[],
  count?: number
): Promise<number> {
  const drafts = await generateCards(prompt, members, count);
  if (drafts.length === 0) return 0;
  const collab = createCollab(board.doc);
  try {
    // Give the relay a moment to send the board's existing state so we target
    // an existing column instead of creating a duplicate.
    await new Promise((r) => setTimeout(r, 900));
    const columns = collab.doc.getArray<Y.Map<any>>("columns");
    const cards = collab.doc.getArray<Y.Map<any>>("cards");
    const n = insertCardDrafts(collab.doc, columns, cards, drafts);
    // Let the local update flush to the relay before tearing the socket down.
    await new Promise((r) => setTimeout(r, 1200));
    return n;
  } finally {
    collab.destroy();
  }
}
