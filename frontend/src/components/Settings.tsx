import { useEffect, useRef, useState } from "react";
import { useStore } from "../store";
import { api } from "../api";
import { applyCustomCss, getCustomCss, saveCustomCss } from "../customcss";
import { notificationsEnabled, requestNotifications } from "../notifications";
import { subscribeToPush } from "../push";
import { getTheme, setTheme, type Theme } from "../theme";
import {
  canInstall,
  isIOS,
  isInstalled,
  onInstallChange,
  promptInstall,
} from "../pwa";
import {
  Settings as SettingsIcon,
  Save,
  RotateCcw,
  Sparkles,
  Bell,
  Sun,
  Moon,
  Smartphone,
  Share,
  Upload,
} from "lucide-react";

const PRESETS: Record<string, string> = {
  "Forest Dusk": "",
  "Meadow Day": `:root{--c-bg:#f1ead3;--c-surface:#fcf7e8;--c-surface-2:#f7f0da;--c-elevated:#ece1c1;--c-border:#dccfa6;--c-text:#2f3a27;--c-muted:#6f7c58;--c-accent:#4f9a5b;--c-accent-2:#e3a93f;--c-accent-soft:#4f9a5b26;--c-hover:rgba(58,74,34,0.05);--c-backdrop:radial-gradient(840px 460px at 82% -14%,#ffe3a0cc,transparent 60%),radial-gradient(720px 540px at 6% 114%,#bfe0a9cc,transparent 60%),linear-gradient(180deg,#eef3da,#f1ead3 62%);}`,
  "Golden Hour": `:root{--c-bg:#241611;--c-surface:#2e1d15;--c-surface-2:#37241a;--c-elevated:#452f22;--c-border:#553a2a;--c-text:#fbeede;--c-muted:#c9a88f;--c-accent:#f29545;--c-accent-2:#e7c14a;--c-accent-soft:#f295452b;--c-hover:rgba(255,220,180,0.05);--c-backdrop:radial-gradient(900px 520px at 80% -10%,#f2954533,transparent 60%),radial-gradient(700px 520px at 10% 112%,#7a3b2233,transparent 60%),linear-gradient(180deg,#2a1812,#1d110c 70%);}`,
  "Mossy Glen": `:root{--c-bg:#0f1c16;--c-surface:#14241b;--c-surface-2:#182b20;--c-elevated:#1f3a2b;--c-border:#294d38;--c-text:#e6f2e6;--c-muted:#92ad97;--c-accent:#73c08a;--c-accent-2:#bfe07a;--c-accent-soft:#73c08a2b;--c-hover:rgba(220,255,220,0.04);--c-backdrop:radial-gradient(820px 480px at 82% -8%,#73c08a26,transparent 60%),radial-gradient(760px 560px at 8% 112%,#3a7a5326,transparent 60%),linear-gradient(180deg,#12211a,#0d1812 70%);}`,
  Sakura: `:root{--c-bg:#f6e9ec;--c-surface:#fdf4f6;--c-surface-2:#f9eef1;--c-elevated:#f1dde3;--c-border:#e8cdd6;--c-text:#3f2e34;--c-muted:#8a6f78;--c-accent:#e57aa0;--c-accent-2:#8cbf7a;--c-accent-soft:#e57aa026;--c-hover:rgba(80,40,55,0.04);--c-backdrop:radial-gradient(840px 460px at 82% -14%,#ffd6e3cc,transparent 60%),radial-gradient(720px 540px at 6% 114%,#cfe7bccc,transparent 60%),linear-gradient(180deg,#fbeef1,#f6e9ec 62%);}`,
  Twilight: `:root{--c-bg:#161427;--c-surface:#1d1b33;--c-surface-2:#23203d;--c-elevated:#2c294b;--c-border:#3a3660;--c-text:#ece9f7;--c-muted:#a59fc4;--c-accent:#e8b24a;--c-accent-2:#9a7bd6;--c-accent-soft:#e8b24a2b;--c-hover:rgba(230,225,255,0.04);--c-backdrop:radial-gradient(880px 520px at 82% -10%,#e8b24a26,transparent 60%),radial-gradient(760px 560px at 8% 112%,#6d4fb033,transparent 60%),linear-gradient(180deg,#1a1730,#12101f 70%);}`,
};

export default function Settings() {
  const user = useStore((s) => s.user);
  const [css, setCss] = useState(getCustomCss());
  const [saved, setSaved] = useState(false);
  const [notif, setNotif] = useState(notificationsEnabled());
  const [theme, setThemeState] = useState<Theme>(getTheme());
  const members = useStore((s) => s.members);
  const refreshMembers = useStore((s) => s.refreshMembers);
  const me = members.find((m) => m.name === user?.name);
  const [status, setStatus] = useState(me?.status || "");
  const [statusSaved, setStatusSaved] = useState(false);

  const [installable, setInstallable] = useState(canInstall());
  useEffect(() => onInstallChange(() => setInstallable(canInstall())), []);

  useEffect(() => {
    if (me) setStatus(me.status);
  }, [me?.status]);

  async function saveStatus() {
    await api.post("/api/members/status", { status });
    await refreshMembers();
    setStatusSaved(true);
    setTimeout(() => setStatusSaved(false), 1500);
  }

  const [avatar, setAvatarVal] = useState(me?.avatar || "");
  const avatarFile = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (me) setAvatarVal(me.avatar);
  }, [me?.avatar]);

  async function saveAvatar(val: string) {
    await api.post("/api/members/avatar", { avatar: val });
    await refreshMembers();
  }
  async function uploadAvatar(file: File | undefined) {
    if (!file) return;
    const uploaded = await api.upload(file);
    setAvatarVal(uploaded.url);
    await saveAvatar(uploaded.url);
  }

  function chooseTheme(t: Theme) {
    setTheme(t);
    setThemeState(t);
  }

  function onChange(value: string) {
    setCss(value);
    applyCustomCss(value); // live preview
    setSaved(false);
  }

  function save() {
    saveCustomCss(css);
    setSaved(true);
  }

  function reset() {
    setCss("");
    saveCustomCss("");
    setSaved(true);
  }

  return (
    <div className="flex h-full flex-col">
      <header className="surface flex items-center gap-3 border-b border-[var(--c-border)] px-4 py-3 pl-14 md:pl-4">
        <SettingsIcon size={18} className="text-[var(--c-muted)]" />
        <div className="font-semibold">Settings</div>
      </header>

      <div className="flex-1 overflow-y-auto p-4">
        <div className="mx-auto max-w-3xl space-y-6">
          <section className="card p-4">
            <div className="mb-2 flex items-center gap-2">
              <Smartphone size={16} className="text-[var(--c-accent)]" />
              <h2 className="font-semibold">Install app</h2>
            </div>
            {isInstalled() ? (
              <p className="text-sm text-[var(--c-muted)]">
                You're running Conventus as an installed app ✓
              </p>
            ) : installable ? (
              <>
                <p className="mb-3 text-sm text-[var(--c-muted)]">
                  Install Conventus to your device for a full-screen, app-like
                  experience that launches from your home screen.
                </p>
                <button
                  className="btn btn-primary"
                  onClick={async () => {
                    await promptInstall();
                    setInstallable(canInstall());
                  }}
                >
                  <Smartphone size={16} /> Install Conventus
                </button>
              </>
            ) : isIOS() ? (
              <p className="flex flex-wrap items-center gap-1.5 text-sm text-[var(--c-muted)]">
                On iPhone / iPad: tap <Share size={14} /> Share, then “Add to Home
                Screen”.
              </p>
            ) : (
              <p className="text-sm text-[var(--c-muted)]">
                Use your browser menu → “Install app” / “Add to Home Screen”
                (requires HTTPS — e.g. a Hugging Face Space).
              </p>
            )}
          </section>

          <section className="card p-4">
            <h2 className="mb-1 font-semibold">Your identity</h2>
            <p className="mb-3 text-sm text-[var(--c-muted)]">
              You're <span style={{ color: user?.color }}>{user?.name}</span>
              {user?.is_admin && " — admin"}. Names are picked at login; log out to
              switch.
            </p>
            <label className="mb-1 block text-xs font-medium text-[var(--c-muted)]">
              Status
            </label>
            <div className="flex gap-2">
              <input
                className="input"
                value={status}
                maxLength={80}
                placeholder="🌿 deep in code…"
                onChange={(e) => setStatus(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && saveStatus()}
              />
              <button className="btn btn-primary shrink-0" onClick={saveStatus}>
                {statusSaved ? "Saved ✓" : "Save"}
              </button>
            </div>

            <label className="mb-1 mt-3 block text-xs font-medium text-[var(--c-muted)]">
              Avatar (emoji, image URL, or upload)
            </label>
            <div className="flex items-center gap-2">
              <span
                className="grid h-10 w-10 shrink-0 place-items-center overflow-hidden rounded-lg text-white"
                style={{ background: avatar ? "transparent" : user?.color }}
              >
                {avatar && /^https?:\/\//.test(avatar) ? (
                  <img src={avatar} alt="" className="h-10 w-10 object-cover" />
                ) : avatar ? (
                  <span className="text-xl">{avatar}</span>
                ) : (
                  user?.name.charAt(0).toUpperCase()
                )}
              </span>
              <input
                className="input"
                value={avatar}
                placeholder="🦊 or https://…"
                onChange={(e) => setAvatarVal(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && saveAvatar(avatar)}
              />
              <button className="btn shrink-0" onClick={() => avatarFile.current?.click()}>
                <Upload size={15} />
              </button>
              <button className="btn btn-primary shrink-0" onClick={() => saveAvatar(avatar)}>
                Save
              </button>
              <input
                ref={avatarFile}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => uploadAvatar(e.target.files?.[0])}
              />
            </div>
          </section>

          <section className="card p-4">
            <h2 className="mb-3 font-semibold">Theme</h2>
            <div className="flex gap-2">
              <button
                className={`btn flex-1 ${theme === "dark" ? "btn-primary" : ""}`}
                onClick={() => chooseTheme("dark")}
              >
                <Moon size={16} /> Dark
              </button>
              <button
                className={`btn flex-1 ${theme === "light" ? "btn-primary" : ""}`}
                onClick={() => chooseTheme("light")}
              >
                <Sun size={16} /> Light
              </button>
            </div>
          </section>

          <section className="card p-4">
            <div className="mb-2 flex items-center gap-2">
              <Bell size={16} className="text-[var(--c-accent)]" />
              <h2 className="font-semibold">Notifications</h2>
            </div>
            <p className="mb-3 text-sm text-[var(--c-muted)]">
              Get notified when someone @mentions you — on this device even when
              the tab is closed (via Web Push), where supported.
            </p>
            <button
              className="btn"
              disabled={notif}
              onClick={async () => {
                const granted = (await requestNotifications()) === "granted";
                setNotif(granted);
                if (granted) await subscribeToPush();
              }}
            >
              {notif ? "Notifications enabled ✓" : "Enable notifications"}
            </button>
          </section>

          <section className="card p-4">
            <div className="mb-2 flex items-center gap-2">
              <Sparkles size={16} className="text-[var(--c-accent)]" />
              <h2 className="font-semibold">Appearance — Custom CSS</h2>
            </div>
            <p className="mb-3 text-sm text-[var(--c-muted)]">
              Reskin Conventus for yourself. This is stored only in your browser
              (localStorage) — nobody else sees it. Override the theme variables or
              target any element.
            </p>

            <div className="mb-3 flex flex-wrap gap-2">
              {Object.entries(PRESETS).map(([name, value]) => (
                <button
                  key={name}
                  className="btn !py-1.5 text-xs"
                  onClick={() => onChange(value)}
                >
                  {name}
                </button>
              ))}
            </div>

            <textarea
              value={css}
              onChange={(e) => onChange(e.target.value)}
              spellCheck={false}
              placeholder={`:root {\n  --c-accent: #ff7a00;\n  --radius: 4px;\n}`}
              className="input h-64 resize-y font-mono text-xs leading-relaxed"
            />

            <div className="mt-3 flex items-center gap-2">
              <button className="btn btn-primary" onClick={save}>
                <Save size={16} /> Save
              </button>
              <button className="btn" onClick={reset}>
                <RotateCcw size={16} /> Reset
              </button>
              {saved && (
                <span className="text-sm text-emerald-400 fade-in">Saved ✓</span>
              )}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
