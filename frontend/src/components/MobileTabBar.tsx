import { useStore } from "../store";
import { MessageSquare, FileText, Pencil, HardDrive, Search } from "lucide-react";

// Bottom navigation shown only on small screens, for one-tap access to the
// main destinations (the sidebar/hamburger still holds channels, DMs, members,
// settings and admin).
export default function MobileTabBar() {
  const view = useStore((s) => s.view);
  const boards = useStore((s) => s.boards);
  const channels = useStore((s) => s.channels);
  const setView = useStore((s) => s.setView);
  const setSearchOpen = useStore((s) => s.setSearchOpen);

  const canvas = boards.find((b) => b.kind === "canvas");
  const board = boards.find((b) => b.kind === "whiteboard");
  const inChat = view.type === "channel" || view.type === "dm";

  const tabs = [
    {
      key: "chat",
      label: "Chat",
      icon: <MessageSquare size={20} />,
      active: inChat,
      onClick: () => {
        if (!inChat && channels[0]) setView({ type: "channel", id: channels[0].id });
      },
    },
    {
      key: "canvas",
      label: "Doc",
      icon: <FileText size={20} />,
      active: view.type === "canvas",
      onClick: () => canvas && setView({ type: "canvas", id: canvas.id }),
    },
    {
      key: "board",
      label: "Board",
      icon: <Pencil size={20} />,
      active: view.type === "whiteboard",
      onClick: () => board && setView({ type: "whiteboard", id: board.id }),
    },
    {
      key: "files",
      label: "Files",
      icon: <HardDrive size={20} />,
      active: view.type === "drive",
      onClick: () => setView({ type: "drive" }),
    },
    {
      key: "search",
      label: "Search",
      icon: <Search size={20} />,
      active: false,
      onClick: () => setSearchOpen(true),
    },
  ];

  return (
    // The home indicator floats over content, so the bar only reserves ~60% of
    // the bottom inset — labels stay clear of it without a fat dead band.
    <nav className="surface flex border-t border-[var(--c-border)] pb-[calc(env(safe-area-inset-bottom)*0.6)] pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)] md:hidden">
      {tabs.map((t) => (
        <button
          key={t.key}
          onClick={t.onClick}
          className={`flex flex-1 flex-col items-center gap-0.5 py-1.5 text-[10px] transition ${
            t.active ? "text-[var(--c-accent)]" : "text-[var(--c-muted)]"
          }`}
        >
          {t.icon}
          {t.label}
        </button>
      ))}
    </nav>
  );
}
