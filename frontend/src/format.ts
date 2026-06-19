// Small formatting helpers: timestamps, file sizes, a segment splitter, and a
// deliberately small, safe markdown-ish renderer (escape first, then format).

export function formatTime(ts: number): string {
  const d = new Date(ts * 1000);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export function formatDate(ts: number): string {
  const d = new Date(ts * 1000);
  const today = new Date();
  const yest = new Date();
  yest.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return "Today";
  if (d.toDateString() === yest.toDateString()) return "Yesterday";
  return d.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let val = bytes / 1024;
  let i = 0;
  while (val >= 1024 && i < units.length - 1) {
    val /= 1024;
    i++;
  }
  return `${val.toFixed(1)} ${units[i]}`;
}

export type Segment =
  | { type: "text"; value: string }
  | { type: "html"; value: string }
  | { type: "code"; value: string; lang?: string };

// Split a message into ordinary text, ```html``` widgets (sandboxed iframes),
// and ```lang fenced code blocks (syntax-highlighted). A bare ``` fence with no
// language is treated as code.
export function splitSegments(content: string): Segment[] {
  const re = /```([\w-]*)[ \t]*\n?([\s\S]*?)```/g;
  const segments: Segment[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content))) {
    if (m.index > last) {
      segments.push({ type: "text", value: content.slice(last, m.index) });
    }
    const lang = m[1].toLowerCase();
    const body = m[2].replace(/\n$/, "");
    if (lang === "html") {
      segments.push({ type: "html", value: body.trim() });
    } else {
      segments.push({ type: "code", value: body, lang: lang || undefined });
    }
    last = m.index + m[0].length;
  }
  if (last < content.length) {
    segments.push({ type: "text", value: content.slice(last) });
  }
  return segments;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeAttr(s: string): string {
  return escapeHtml(s).replace(/"/g, "&quot;");
}

const URL_RE = /(https?:\/\/[^\s<]+)/g;
// Null-char sentinel: never present in user text and untouched by escaping.
const SENTINEL = String.fromCharCode(0);

// --- Markdown tables ------------------------------------------------------

const SEP_RE = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;

function splitRow(line: string): string[] {
  let s = line.trim();
  if (s.startsWith("|")) s = s.slice(1);
  if (s.endsWith("|")) s = s.slice(0, -1);
  return s.split("|").map((c) => c.trim());
}

function inlineCell(text: string): string {
  let s = escapeHtml(text.trim());
  s = s.replace(/`([^`]+)`/g, "<code>$1</code>");
  s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  s = s.replace(
    URL_RE,
    (u) => `<a href="${u}" target="_blank" rel="noopener noreferrer">${u}</a>`
  );
  return s;
}

function buildTable(rows: string[][], aligns: string[]): string {
  const cell = (c: string, tag: string, i: number) =>
    `<${tag}${aligns[i] ? ` style="text-align:${aligns[i]}"` : ""}>${inlineCell(c)}</${tag}>`;
  const head = `<tr>${rows[0].map((c, i) => cell(c, "th", i)).join("")}</tr>`;
  const body = rows
    .slice(1)
    .map((r) => `<tr>${r.map((c, i) => cell(c, "td", i)).join("")}</tr>`)
    .join("");
  return `<table class="md-table"><thead>${head}</thead><tbody>${body}</tbody></table>`;
}

function extractTables(text: string, hold: (html: string) => string): string {
  const lines = text.split("\n");
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const next = lines[i + 1];
    if (line.includes("|") && next && SEP_RE.test(next) && next.includes("-")) {
      const header = splitRow(line);
      const aligns = splitRow(next).map((s) => {
        const l = s.startsWith(":");
        const r = s.endsWith(":");
        return l && r ? "center" : r ? "right" : l ? "left" : "";
      });
      const rows = [header];
      i += 2;
      while (i < lines.length && lines[i].includes("|") && lines[i].trim() !== "") {
        rows.push(splitRow(lines[i]));
        i++;
      }
      out.push(hold(buildTable(rows, aligns)));
    } else {
      out.push(line);
      i++;
    }
  }
  return out.join("\n");
}

export function renderContent(text: string): string {
  // Hold out tables, images/media and markdown links so later passes (escaping,
  // bare URL linkify) don't corrupt their attributes.
  const embeds: string[] = [];
  const hold = (html: string) => {
    embeds.push(html);
    return `${SENTINEL}${embeds.length - 1}${SENTINEL}`;
  };

  let work = extractTables(text, hold);

  work = work.replace(
    /!\[([^\]]*)\]\((https?:\/\/[^\s)]+)\)/g,
    (_m, alt, url) => {
      const u = escapeAttr(url);
      if (/\.(mp4|webm|ogv)(\?|$)/i.test(url))
        return hold(`<video src="${u}" controls playsinline preload="metadata" class="md-media"></video>`);
      if (/\.(mp3|wav|m4a|oga|ogg|opus)(\?|$)/i.test(url))
        return hold(`<audio src="${u}" controls class="md-media"></audio>`);
      return hold(
        `<img src="${u}" alt="${escapeAttr(alt)}" loading="lazy" class="md-media"/>`
      );
    }
  );
  work = work.replace(
    /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
    (_m, label, url) =>
      hold(
        `<a href="${escapeAttr(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(
          label
        )}</a>`
      )
  );

  work = escapeHtml(work);

  // Block elements (line-based).
  work = work.replace(
    /^(#{1,3})\s+(.+)$/gm,
    (_m, h: string, t: string) => `<h${h.length} class="md-h">${t}</h${h.length}>`
  );
  work = work.replace(/^&gt;\s?(.*)$/gm, "<blockquote>$1</blockquote>");
  work = work.replace(/^[-*]\s+(.+)$/gm, "<li>$1</li>");
  work = work.replace(/^---+$/gm, "<hr/>");

  // Inline.
  work = work.replace(/`([^`]+)`/g, "<code>$1</code>");
  work = work.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  work = work.replace(/(^|\s)\*([^*]+)\*/g, "$1<em>$2</em>");
  work = work.replace(
    URL_RE,
    (url) => `<a href="${url}" target="_blank" rel="noopener noreferrer">${url}</a>`
  );
  work = work.replace(/(^|\s)(@[\w.\-]+)/g, '$1<span class="mention">$2</span>');

  // Newlines → <br/>, but not directly after a block-level element.
  work = work.replace(/\n/g, "<br/>");
  work = work.replace(/(<\/(?:h[1-3]|blockquote|li)>|<hr\/>)<br\/>/g, "$1");

  // Restore held-out embeds.
  return work.replace(
    new RegExp(`${SENTINEL}(\\d+)${SENTINEL}`, "g"),
    (_m, i) => embeds[Number(i)] ?? ""
  );
}
