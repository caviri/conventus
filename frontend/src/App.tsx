import { useEffect, useRef, useState } from "react";
import { useStore } from "./store";
import { connectWs, disconnectWs } from "./ws";
import { loadCustomCss } from "./customcss";
import { loadTheme } from "./theme";
import { notificationsEnabled } from "./notifications";
import { subscribeToPush } from "./push";
import Login from "./components/Login";
import Sidebar from "./components/Sidebar";
import ChatView from "./components/ChatView";
import Drive from "./components/Drive";
import Canvas from "./components/Canvas";
import Whiteboard from "./components/Whiteboard";
import Kanban from "./components/Kanban";
import Room from "./components/Room";
import Settings from "./components/Settings";
import AdminPanel from "./components/AdminPanel";
import Search from "./components/Search";
import Lightbox from "./components/Lightbox";
import DropZone from "./components/DropZone";
import MobileTabBar from "./components/MobileTabBar";
import ConnectionBanner from "./components/ConnectionBanner";
import { Menu } from "lucide-react";

export default function App() {
  const ready = useStore((s) => s.ready);
  const user = useStore((s) => s.user);
  const view = useStore((s) => s.view);
  const boards = useStore((s) => s.boards);
  const bootstrap = useStore((s) => s.bootstrap);
  const setView = useStore((s) => s.setView);
  const searchOpen = useStore((s) => s.searchOpen);
  const setSearchOpen = useStore((s) => s.setSearchOpen);
  const setLightbox = useStore((s) => s.setLightbox);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const deepLinked = useRef(false);

  // Honor a ?msg=<channelId>-<messageId> permalink on first load.
  useEffect(() => {
    if (!user || deepLinked.current) return;
    deepLinked.current = true;
    const msg = new URLSearchParams(location.search).get("msg");
    if (!msg) return;
    const [cid, mid] = msg.split("-").map(Number);
    history.replaceState(null, "", location.pathname);
    if (!cid || !mid) return;
    setView({ type: "channel", id: cid }).then(() => {
      setTimeout(() => {
        const el = document.getElementById(`msg-${mid}`);
        if (el) {
          el.scrollIntoView({ block: "center" });
          el.classList.add("flash");
          setTimeout(() => el.classList.remove("flash"), 1200);
        }
      }, 450);
    });
  }, [user, setView]);

  useEffect(() => {
    loadTheme();
    loadCustomCss();
    bootstrap();
  }, [bootstrap]);

  useEffect(() => {
    if (user) {
      connectWs();
      return () => disconnectWs();
    }
  }, [user]);

  // Refresh the push subscription for users who've already opted in.
  useEffect(() => {
    if (user && notificationsEnabled()) void subscribeToPush();
  }, [user]);

  useEffect(() => {
    if (!user) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSearchOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [user, setSearchOpen]);

  // Open markdown images (rendered as raw HTML) in the lightbox on click.
  useEffect(() => {
    if (!user) return;
    const onClick = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      if (t instanceof HTMLImageElement && t.classList.contains("md-media")) {
        setLightbox({ url: t.src });
      }
    };
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, [user, setLightbox]);

  if (!ready) {
    return (
      <div className="flex h-full items-center justify-center text-[var(--c-muted)]">
        Loading…
      </div>
    );
  }

  if (!user) return <Login />;

  const board =
    view.type === "canvas" ||
    view.type === "whiteboard" ||
    view.type === "kanban" ||
    view.type === "room"
      ? boards.find((b) => b.id === view.id)
      : undefined;

  return (
    <div className="flex h-full overflow-hidden">
      {searchOpen && <Search />}
      <Lightbox />
      <DropZone />
      <ConnectionBanner />
      {/* Mobile backdrop */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-20 bg-black/50 md:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}
      <div
        className={`fixed z-30 h-full transition-transform md:static md:translate-x-0 ${
          sidebarOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <Sidebar onNavigate={() => setSidebarOpen(false)} />
      </div>

      <main className="flex min-w-0 flex-1 flex-col">
        <button
          className="btn absolute left-3 top-[calc(0.7rem+env(safe-area-inset-top))] z-10 !p-2 md:top-3 md:hidden"
          onClick={() => setSidebarOpen(true)}
          aria-label="Open menu"
        >
          <Menu size={18} />
        </button>
        {view.type === "channel" ||
        view.type === "dm" ||
        view.type === "conversation" ? (
          <ChatView />
        ) : view.type === "drive" ? (
          <Drive />
        ) : view.type === "canvas" ? (
          board && (
            <Canvas key={board.doc} id={board.id} name={board.doc} title={board.name} />
          )
        ) : view.type === "whiteboard" ? (
          board && (
            <Whiteboard key={board.doc} id={board.id} name={board.doc} title={board.name} />
          )
        ) : view.type === "kanban" ? (
          board && (
            <Kanban key={board.doc} id={board.id} name={board.doc} title={board.name} />
          )
        ) : view.type === "room" ? (
          board && (
            <Room key={board.doc} id={board.id} name={board.doc} title={board.name} />
          )
        ) : view.type === "settings" ? (
          <Settings />
        ) : (
          <AdminPanel />
        )}
        <MobileTabBar />
      </main>
    </div>
  );
}
