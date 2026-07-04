import { useState } from "react";
import { useStore } from "../store";
import { notificationsEnabled, requestNotifications } from "../notifications";
import { pushSupported, subscribeToPush } from "../push";
import {
  Menu,
  Hash,
  Search,
  Settings as SettingsIcon,
  Shield,
  Bell,
} from "lucide-react";

// The mobile menu "dot": a small floating button that opens a submenu, and —
// until first used — carries a pulsing badge plus a hint bubble so newcomers
// discover that channels, people and boards live in the sidebar.

const HINT_KEY = "conventus.hint.sidebar";

export default function FloatingMenu({ onOpenSidebar }: { onOpenSidebar: () => void }) {
  const user = useStore((s) => s.user);
  const setView = useStore((s) => s.setView);
  const setSearchOpen = useStore((s) => s.setSearchOpen);
  const [open, setOpen] = useState(false);
  const [hint, setHint] = useState(() => !localStorage.getItem(HINT_KEY));
  const [notifOn, setNotifOn] = useState(() => notificationsEnabled());
  const canAskNotif =
    pushSupported() && "Notification" in window && Notification.permission === "default";

  function dismissHint() {
    if (!hint) return;
    localStorage.setItem(HINT_KEY, "1");
    setHint(false);
  }

  function item(action: () => void) {
    return () => {
      dismissHint();
      setOpen(false);
      action();
    };
  }

  return (
    <div
      className="absolute top-[calc(0.7rem+env(safe-area-inset-top))] z-20 md:hidden"
      style={{ left: "max(0.75rem, env(safe-area-inset-left))" }}
    >
      <button
        aria-label="Menu"
        onClick={() => {
          dismissHint();
          setOpen((v) => !v);
        }}
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

      {/* One-time nudge: there's a whole sidebar behind this dot. Below the
          dot so it never covers the header title. */}
      {hint && !open && (
        <button
          onClick={() => {
            dismissHint();
            onOpenSidebar();
          }}
          className="card fade-in absolute left-0 top-12 whitespace-nowrap px-3 py-1.5 text-xs shadow-xl"
        >
          Channels, people & boards live here ↑
        </button>
      )}

      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="card fade-in absolute left-0 top-12 z-20 w-60 overflow-hidden p-1 text-sm shadow-2xl">
            <button
              className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 hover:bg-[var(--c-elevated)]"
              onClick={item(onOpenSidebar)}
            >
              <Hash size={15} className="text-[var(--c-accent)]" /> Channels, people & boards
            </button>
            <button
              className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 hover:bg-[var(--c-elevated)]"
              onClick={item(() => setSearchOpen(true))}
            >
              <Search size={15} className="text-[var(--c-muted)]" /> Search
            </button>
            <button
              className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 hover:bg-[var(--c-elevated)]"
              onClick={item(() => setView({ type: "settings" }))}
            >
              <SettingsIcon size={15} className="text-[var(--c-muted)]" /> Settings
            </button>
            {canAskNotif && !notifOn && (
              <button
                className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 hover:bg-[var(--c-elevated)]"
                onClick={item(async () => {
                  const granted = (await requestNotifications()) === "granted";
                  setNotifOn(granted);
                  if (granted) await subscribeToPush();
                })}
              >
                <Bell size={15} className="text-[var(--c-accent-2)]" /> Turn on notifications
              </button>
            )}
            {user?.is_admin && (
              <button
                className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 hover:bg-[var(--c-elevated)]"
                onClick={item(() => setView({ type: "admin" }))}
              >
                <Shield size={15} className="text-amber-400" /> Admin
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
