// Lazy-loaded unicode emoji catalog (emojibase compact data + shortcodes),
// shared by the emoji picker and the composer's ":" autocomplete. The JSON is
// dynamically imported so it ships as its own chunk, fetched on first use —
// never in the main bundle.

export interface EmojiEntry {
  unicode: string; // the emoji character itself
  label: string; // "grinning face"
  group: number; // emojibase group id
  tags: string[];
  shortcodes: string[]; // ["grinning"]
}

// Emojibase group ids → picker categories. Group 2 (components: skin-tone
// swatches, hair styles) is intentionally absent.
export const EMOJI_GROUPS: { id: number; label: string; icon: string }[] = [
  { id: 0, label: "Smileys", icon: "😀" },
  { id: 1, label: "People", icon: "👋" },
  { id: 3, label: "Nature", icon: "🐻" },
  { id: 4, label: "Food", icon: "🍔" },
  { id: 5, label: "Travel", icon: "🌍" },
  { id: 6, label: "Activities", icon: "⚽" },
  { id: 7, label: "Objects", icon: "💡" },
  { id: 8, label: "Symbols", icon: "❤️" },
  { id: 9, label: "Flags", icon: "🚩" },
];

let catalog: EmojiEntry[] | null = null;
let byShortcode: Map<string, EmojiEntry> | null = null;
let loading: Promise<EmojiEntry[]> | null = null;

export function emojiCatalog(): EmojiEntry[] | null {
  return catalog;
}

export function loadEmojiData(): Promise<EmojiEntry[]> {
  if (catalog) return Promise.resolve(catalog);
  if (!loading) {
    loading = Promise.all([
      import("emojibase-data/en/compact.json"),
      import("emojibase-data/en/shortcodes/emojibase.json"),
    ]).then(([data, codes]) => {
      const shortcodes = codes.default as Record<string, string | string[]>;
      const list: EmojiEntry[] = [];
      for (const e of data.default as any[]) {
        // Top-level entries are base emoji (skin-tone variants live nested
        // under `skins`); entries without a group are components/regionals.
        if (e.group === undefined || e.group === 2) continue;
        const sc = shortcodes[e.hexcode];
        list.push({
          unicode: e.unicode,
          label: e.label,
          group: e.group,
          tags: e.tags || [],
          shortcodes: !sc ? [] : Array.isArray(sc) ? sc : [sc],
        });
      }
      catalog = list; // emojibase data is already in group+order sequence
      byShortcode = new Map();
      for (const e of list) for (const s of e.shortcodes) byShortcode.set(s, e);
      return list;
    });
  }
  return loading;
}

// Rank prefix matches on label/shortcode above substring matches on anything.
export function searchEmoji(query: string, limit = 60): EmojiEntry[] {
  if (!catalog) return [];
  const q = query.toLowerCase().trim();
  if (!q) return [];
  const starts: EmojiEntry[] = [];
  const contains: EmojiEntry[] = [];
  for (const e of catalog) {
    const label = e.label.toLowerCase();
    if (label.startsWith(q) || e.shortcodes.some((s) => s.startsWith(q))) {
      starts.push(e);
      if (starts.length >= limit) break;
    } else if (
      label.includes(q) ||
      e.shortcodes.some((s) => s.includes(q)) ||
      e.tags.some((t) => t.includes(q))
    ) {
      contains.push(e);
    }
  }
  return [...starts, ...contains].slice(0, limit);
}

// --- Recently used ---------------------------------------------------------
// Stored as the raw reaction values: a unicode char, or ":name:" for custom.

const RECENT_KEY = "conventus.recentEmoji";
const RECENT_MAX = 24;
const RECENT_SEED = ["👍", "❤️", "😂", "🎉", "🚀", "👀", "✅", "🔥"];

export function recentEmoji(): string[] {
  try {
    const list = JSON.parse(localStorage.getItem(RECENT_KEY) || "[]");
    if (Array.isArray(list) && list.length) return list.slice(0, RECENT_MAX);
  } catch {
    /* fall through to seed */
  }
  return RECENT_SEED;
}

export function pushRecentEmoji(value: string) {
  const next = [value, ...recentEmoji().filter((v) => v !== value)].slice(0, RECENT_MAX);
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    /* private mode etc. — recents just won't persist */
  }
}
