import { useEffect, useRef, useState } from "react";
import { useStore } from "../store";
import { api } from "../api";
import AssistantSettings from "./AssistantSettings";
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
  Lock,
  Unlock,
} from "lucide-react";

// Every preset ships a dark and a light variant. The same palettes live as
// readable CSS files in the repo's themes/ folder.
const THEMES_URL = "https://github.com/caviri/conventus/tree/main/themes";

type PresetVariant = { label: string; css: string };
const PRESETS: Record<string, { dark: PresetVariant; light: PresetVariant }> = {
  Forest: {
    dark: {
      label: "Forest Dusk",
      css: `:root{--c-bg:#14211a;--c-surface:#1a2a20;--c-surface-2:#1f3226;--c-elevated:#284130;--c-border:#335041;--c-text:#eef4e6;--c-muted:#a6b9a0;--c-accent:#e8b24a;--c-accent-2:#6fb98a;--c-accent-soft:#e8b24a2b;--c-hover:rgba(255,244,214,0.05);--c-backdrop:radial-gradient(820px 480px at 84% -10%,#e8b24a26,transparent 62%),radial-gradient(760px 560px at 10% 112%,#3f9c6a2e,transparent 60%),linear-gradient(180deg,#182a1f,#111c15 70%);}`,
    },
    light: {
      label: "Meadow Day",
      css: `:root{--c-bg:#f1ead3;--c-surface:#fcf7e8;--c-surface-2:#f7f0da;--c-elevated:#ece1c1;--c-border:#dccfa6;--c-text:#2f3a27;--c-muted:#6f7c58;--c-accent:#4f9a5b;--c-accent-2:#e3a93f;--c-accent-soft:#4f9a5b26;--c-hover:rgba(58,74,34,0.05);--c-backdrop:radial-gradient(840px 460px at 82% -14%,#ffe3a0cc,transparent 60%),radial-gradient(720px 540px at 6% 114%,#bfe0a9cc,transparent 60%),linear-gradient(180deg,#eef3da,#f1ead3 62%);}`,
    },
  },
  "Golden Hour": {
    dark: {
      label: "Golden Hour",
      css: `:root{--c-bg:#241611;--c-surface:#2e1d15;--c-surface-2:#37241a;--c-elevated:#452f22;--c-border:#553a2a;--c-text:#fbeede;--c-muted:#c9a88f;--c-accent:#f29545;--c-accent-2:#e7c14a;--c-accent-soft:#f295452b;--c-hover:rgba(255,220,180,0.05);--c-backdrop:radial-gradient(900px 520px at 80% -10%,#f2954533,transparent 60%),radial-gradient(700px 520px at 10% 112%,#7a3b2233,transparent 60%),linear-gradient(180deg,#2a1812,#1d110c 70%);}`,
    },
    light: {
      label: "Golden Morning",
      css: `:root{--c-bg:#f8ecdc;--c-surface:#fdf6ea;--c-surface-2:#faf0df;--c-elevated:#f2e2c6;--c-border:#e6cfa6;--c-text:#46301d;--c-muted:#94714e;--c-accent:#d97b2f;--c-accent-2:#d9a93f;--c-accent-soft:#d97b2f26;--c-hover:rgba(120,70,20,0.05);--c-backdrop:radial-gradient(840px 460px at 82% -14%,#ffd9a3cc,transparent 60%),radial-gradient(720px 540px at 6% 114%,#f5c98ccc,transparent 60%),linear-gradient(180deg,#fbf0dd,#f8ecdc 62%);}`,
    },
  },
  "Mossy Glen": {
    dark: {
      label: "Mossy Glen",
      css: `:root{--c-bg:#0f1c16;--c-surface:#14241b;--c-surface-2:#182b20;--c-elevated:#1f3a2b;--c-border:#294d38;--c-text:#e6f2e6;--c-muted:#92ad97;--c-accent:#73c08a;--c-accent-2:#bfe07a;--c-accent-soft:#73c08a2b;--c-hover:rgba(220,255,220,0.04);--c-backdrop:radial-gradient(820px 480px at 82% -8%,#73c08a26,transparent 60%),radial-gradient(760px 560px at 8% 112%,#3a7a5326,transparent 60%),linear-gradient(180deg,#12211a,#0d1812 70%);}`,
    },
    light: {
      label: "Misty Glen",
      css: `:root{--c-bg:#e7efe2;--c-surface:#f4f9f0;--c-surface-2:#edf4e7;--c-elevated:#dce8d2;--c-border:#c3d6b6;--c-text:#283827;--c-muted:#657a5e;--c-accent:#3f8e5d;--c-accent-2:#7fae3d;--c-accent-soft:#3f8e5d26;--c-hover:rgba(40,70,40,0.05);--c-backdrop:radial-gradient(840px 460px at 82% -14%,#cfe8bbcc,transparent 60%),radial-gradient(720px 540px at 6% 114%,#a9d4b3cc,transparent 60%),linear-gradient(180deg,#edf4e4,#e7efe2 62%);}`,
    },
  },
  Sakura: {
    dark: {
      label: "Sakura Night",
      css: `:root{--c-bg:#241622;--c-surface:#2d1c2a;--c-surface-2:#352232;--c-elevated:#422c3e;--c-border:#543a4e;--c-text:#f6e9f0;--c-muted:#bb95a9;--c-accent:#e57aa0;--c-accent-2:#8cbf7a;--c-accent-soft:#e57aa02b;--c-hover:rgba(255,215,235,0.05);--c-backdrop:radial-gradient(880px 520px at 82% -10%,#e57aa026,transparent 60%),radial-gradient(760px 560px at 8% 112%,#6d3b5733,transparent 60%),linear-gradient(180deg,#2a1827,#1c1019 70%);}`,
    },
    light: {
      label: "Sakura Day",
      css: `:root{--c-bg:#f6e9ec;--c-surface:#fdf4f6;--c-surface-2:#f9eef1;--c-elevated:#f1dde3;--c-border:#e8cdd6;--c-text:#3f2e34;--c-muted:#8a6f78;--c-accent:#e57aa0;--c-accent-2:#8cbf7a;--c-accent-soft:#e57aa026;--c-hover:rgba(80,40,55,0.04);--c-backdrop:radial-gradient(840px 460px at 82% -14%,#ffd6e3cc,transparent 60%),radial-gradient(720px 540px at 6% 114%,#cfe7bccc,transparent 60%),linear-gradient(180deg,#fbeef1,#f6e9ec 62%);}`,
    },
  },
  Twilight: {
    dark: {
      label: "Twilight",
      css: `:root{--c-bg:#161427;--c-surface:#1d1b33;--c-surface-2:#23203d;--c-elevated:#2c294b;--c-border:#3a3660;--c-text:#ece9f7;--c-muted:#a59fc4;--c-accent:#e8b24a;--c-accent-2:#9a7bd6;--c-accent-soft:#e8b24a2b;--c-hover:rgba(230,225,255,0.04);--c-backdrop:radial-gradient(880px 520px at 82% -10%,#e8b24a26,transparent 60%),radial-gradient(760px 560px at 8% 112%,#6d4fb033,transparent 60%),linear-gradient(180deg,#1a1730,#12101f 70%);}`,
    },
    light: {
      label: "Lavender Day",
      css: `:root{--c-bg:#edeaf6;--c-surface:#f8f6fc;--c-surface-2:#f2eff9;--c-elevated:#e3ddf1;--c-border:#d0c7e6;--c-text:#332c49;--c-muted:#6f6890;--c-accent:#7a5fc8;--c-accent-2:#d9a23f;--c-accent-soft:#7a5fc826;--c-hover:rgba(60,45,110,0.05);--c-backdrop:radial-gradient(840px 460px at 82% -14%,#d8c9f5cc,transparent 60%),radial-gradient(720px 540px at 6% 114%,#f5dfa9cc,transparent 60%),linear-gradient(180deg,#f1edf9,#edeaf6 62%);}`,
    },
  },
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

  const [namePw, setNamePw] = useState("");
  const [nameMsg, setNameMsg] = useState("");

  async function protectName() {
    if (!namePw) return;
    await api.post("/api/auth/protect", { password: namePw });
    await refreshMembers();
    setNamePw("");
    setNameMsg("Your name is now protected ✓");
    setTimeout(() => setNameMsg(""), 2500);
  }

  async function unprotectName() {
    await api.post("/api/auth/protect", { password: "" });
    await refreshMembers();
    setNamePw("");
    setNameMsg("Protection removed");
    setTimeout(() => setNameMsg(""), 2500);
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
          <AssistantSettings />

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
            <div className="mb-2 flex items-center gap-2">
              <Lock size={16} className="text-[var(--c-accent)]" />
              <h2 className="font-semibold">Protect your name</h2>
            </div>
            <p className="mb-3 text-sm text-[var(--c-muted)]">
              {me?.reserved ? (
                <>
                  <span className="text-[var(--c-accent)]">
                    {user?.name} is protected.
                  </span>{" "}
                  Logging in with this name requires your personal password —
                  the room password alone won't work. Enter a new password to
                  change it, or remove the protection below.
                </>
              ) : (
                <>
                  Set a personal password for{" "}
                  <span style={{ color: user?.color }}>{user?.name}</span>.
                  Afterwards, anyone logging in with this name must use that
                  password — the room password alone won't be enough.
                </>
              )}
            </p>
            <div className="flex gap-2">
              <input
                className="input"
                type="password"
                value={namePw}
                maxLength={128}
                placeholder={me?.reserved ? "New personal password…" : "Personal password…"}
                onChange={(e) => setNamePw(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && protectName()}
              />
              <button
                className="btn btn-primary shrink-0"
                disabled={!namePw}
                onClick={protectName}
              >
                <Lock size={15} /> {me?.reserved ? "Update" : "Protect"}
              </button>
              {me?.reserved && (
                <button className="btn shrink-0" onClick={unprotectName}>
                  <Unlock size={15} /> Remove
                </button>
              )}
            </div>
            {nameMsg && (
              <p className="mt-2 text-sm text-emerald-400 fade-in">{nameMsg}</p>
            )}
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

            <div className="mb-2 flex flex-wrap gap-2">
              {Object.entries(PRESETS).map(([name, variants]) => (
                <div
                  key={name}
                  className="flex items-stretch overflow-hidden rounded-full border border-[var(--c-border)] bg-[var(--c-surface-2)]"
                >
                  <span className="px-2.5 py-1.5 text-xs font-medium">
                    {name}
                  </span>
                  <button
                    className="border-l border-[var(--c-border)] px-2 text-[var(--c-muted)] transition-colors hover:bg-[var(--c-hover)] hover:text-[var(--c-text)]"
                    title={`${variants.dark.label} (dark)`}
                    aria-label={`${variants.dark.label} (dark)`}
                    onClick={() => onChange(variants.dark.css)}
                  >
                    <Moon size={13} />
                  </button>
                  <button
                    className="border-l border-[var(--c-border)] px-2 text-[var(--c-muted)] transition-colors hover:bg-[var(--c-hover)] hover:text-[var(--c-text)]"
                    title={`${variants.light.label} (light)`}
                    aria-label={`${variants.light.label} (light)`}
                    onClick={() => onChange(variants.light.css)}
                  >
                    <Sun size={13} />
                  </button>
                </div>
              ))}
            </div>

            <p className="mb-3 text-xs text-[var(--c-muted)]">
              Each preset comes in a dark (<Moon size={11} className="inline" />)
              and a light (<Sun size={11} className="inline" />) variant. The
              full CSS for every theme lives in the{" "}
              <a
                href={THEMES_URL}
                target="_blank"
                rel="noreferrer"
                className="text-[var(--c-accent)] underline"
              >
                themes folder on GitHub
              </a>{" "}
              — copy one as a starting point for your own look.
            </p>

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
