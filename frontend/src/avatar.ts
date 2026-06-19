// Procedural avatars: a deterministic identicon rendered as an SVG data URI.
//
// Avatars are stored as a plain string: an http(s) image URL, an emoji, or a
// "proc:<seed>" marker for a generated icon. When the field is empty we fall
// back to a procedural icon seeded from the member's name, so everyone gets a
// distinctive default without uploading anything.

function hash(str: string): number {
  // FNV-1a — small, fast, well-distributed for short strings.
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** A deterministic identicon (5×5, horizontally mirrored) as an SVG data URI. */
export function proceduralAvatar(seed: string): string {
  const h = hash(seed || "anon");
  const hue = h % 360;
  const bg = `hsl(${hue} 42% 20%)`;
  const fg = `hsl(${(hue + 38) % 360} 68% 62%)`;

  // A tiny LCG seeded from the hash drives the cell pattern.
  let rng = h || 1;
  const next = () => {
    rng = (Math.imul(rng, 1664525) + 1013904223) >>> 0;
    return rng;
  };

  const S = 5;
  const cell = 100 / S;
  const rects: string[] = [];
  for (let col = 0; col < Math.ceil(S / 2); col++) {
    for (let row = 0; row < S; row++) {
      if (next() % 2 === 0) continue; // ~half the cells filled
      const mirror = S - 1 - col;
      rects.push(`<rect x="${col * cell}" y="${row * cell}" width="${cell}" height="${cell}"/>`);
      if (mirror !== col)
        rects.push(`<rect x="${mirror * cell}" y="${row * cell}" width="${cell}" height="${cell}"/>`);
    }
  }

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">` +
    `<rect width="100" height="100" fill="${bg}"/>` +
    `<g fill="${fg}">${rects.join("")}</g></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

/** Resolve a stored avatar string to an <img> src, or null if it's an emoji. */
export function avatarSrc(avatar: string | null | undefined, name: string): string | null {
  if (avatar && /^https?:\/\//.test(avatar)) return avatar;
  if (avatar && avatar.startsWith("proc:")) return proceduralAvatar(avatar.slice(5));
  if (avatar) return null; // an emoji — rendered as text
  return proceduralAvatar(name); // empty → procedural default
}

/** A fresh random "proc:<seed>" marker for the generate button. */
export function randomProcAvatar(): string {
  return `proc:${Math.random().toString(36).slice(2, 10)}`;
}
