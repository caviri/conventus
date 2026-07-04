import { useState } from "react";
import { Menu } from "lucide-react";

// The mobile menu "dot": one tap opens the sidebar (channels, people, boards).
// Until first used it carries a pulsing badge plus a hint bubble so newcomers
// know where everything lives.

const HINT_KEY = "conventus.hint.sidebar";

export default function FloatingMenu({ onOpenSidebar }: { onOpenSidebar: () => void }) {
  const [hint, setHint] = useState(() => !localStorage.getItem(HINT_KEY));

  function open() {
    if (hint) {
      localStorage.setItem(HINT_KEY, "1");
      setHint(false);
    }
    onOpenSidebar();
  }

  return (
    <div
      className="absolute top-[calc(0.7rem+env(safe-area-inset-top))] z-20 md:hidden"
      style={{ left: "max(0.75rem, env(safe-area-inset-left))" }}
    >
      <button
        aria-label="Menu"
        onClick={open}
        className="relative grid h-10 w-10 place-items-center rounded-full text-white shadow-lg transition active:scale-95"
        style={{
          background: "linear-gradient(135deg, var(--c-accent), var(--c-accent-2))",
          boxShadow: "0 6px 18px -6px rgba(0,0,0,.55)",
        }}
      >
        <Menu size={17} />
        {hint && (
          <span className="absolute -right-0.5 -top-0.5 h-3 w-3 animate-pulse rounded-full bg-[var(--c-accent-2)] ring-2 ring-[var(--c-surface)]" />
        )}
      </button>

      {hint && (
        <button
          onClick={open}
          className="card fade-in absolute left-0 top-12 whitespace-nowrap px-3 py-1.5 text-xs shadow-xl"
        >
          Channels, people & boards live here ↑
        </button>
      )}
    </div>
  );
}
