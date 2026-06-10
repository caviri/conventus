import type { LinkPreview as LinkPreviewType } from "../types";
import { useStore } from "../store";

export default function LinkPreview({ p }: { p: LinkPreviewType }) {
  const setLightbox = useStore((s) => s.setLightbox);

  if (p.type === "image") {
    return (
      <img
        src={p.image}
        alt=""
        loading="lazy"
        onClick={() => p.image && setLightbox({ url: p.image })}
        className="max-h-72 cursor-zoom-in rounded-xl border border-[var(--c-border)] object-contain transition hover:brightness-105"
      />
    );
  }

  if (p.type === "video") {
    // Linked media (incl. GIF-replacement webm/mp4) plays inline, gif-style:
    // autoplay + loop + muted so it behaves like an animated GIF.
    return (
      <video
        src={p.video || p.url}
        poster={p.image}
        controls
        autoPlay
        loop
        muted
        playsInline
        className="max-h-80 max-w-full rounded-xl border border-[var(--c-border)]"
      />
    );
  }

  return (
    <a
      href={p.url}
      target="_blank"
      rel="noopener noreferrer"
      className="card flex max-w-lg overflow-hidden transition hover:border-[var(--c-accent)]"
    >
      <div
        className="w-1 shrink-0"
        style={{ background: "var(--c-accent)" }}
      />
      {p.image && (
        <img
          src={p.image}
          alt=""
          loading="lazy"
          className="h-24 w-24 shrink-0 object-cover"
        />
      )}
      <div className="min-w-0 p-3">
        {p.site && (
          <div className="truncate text-xs text-[var(--c-muted)]">{p.site}</div>
        )}
        <div className="truncate text-sm font-semibold">{p.title}</div>
        {p.description && (
          <div className="mt-0.5 line-clamp-2 text-xs text-[var(--c-muted)]">
            {p.description}
          </div>
        )}
      </div>
    </a>
  );
}
