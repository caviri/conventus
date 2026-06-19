import { avatarSrc } from "../avatar";

/** Renders a member/bot avatar: image URL, procedural identicon, or emoji.
 *  An empty avatar falls back to a procedural icon seeded from `name`. */
export default function Avatar({
  avatar,
  name,
  color = "#94a3b8",
  className = "h-9 w-9",
  rounded = "rounded-lg",
  emojiClass = "text-xl",
}: {
  avatar: string | null | undefined;
  name: string;
  color?: string;
  className?: string;
  rounded?: string;
  emojiClass?: string;
}) {
  const base = `${className} ${rounded} overflow-hidden shrink-0`;
  const src = avatarSrc(avatar, name);
  if (src) return <img src={src} alt="" className={`${base} object-cover`} />;
  // An emoji avatar — centered on the member's colour.
  return (
    <span
      className={`${base} grid place-items-center ${emojiClass}`}
      style={{ background: color }}
    >
      {avatar}
    </span>
  );
}
