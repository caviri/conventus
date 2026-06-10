import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import { useStore } from "../store";
import type { User } from "../types";
import { ChevronDown, KeyRound, MessagesSquare } from "lucide-react";

export default function Login() {
  const roomName = useStore((s) => s.roomName);
  const login = useStore((s) => s.login);
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [namePassword, setNamePassword] = useState("");
  const [adminPassword, setAdminPassword] = useState("");
  const [advanced, setAdvanced] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const namePasswordRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const saved = localStorage.getItem("conventus.name");
    if (saved) setName(saved);
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      const res = await api.post<{ token: string; user: User }>("/api/auth/login", {
        password,
        name: name.trim(),
        name_password: namePassword || undefined,
        admin_password: adminPassword || undefined,
      });
      localStorage.setItem("conventus.name", res.user.name);
      await login(res.token, res.user);
    } catch (err: any) {
      const message = err.message || "Login failed";
      if (message.toLowerCase().includes("reserved")) {
        setAdvanced(true);
        setError("That name is reserved. Enter its name password below.");
        requestAnimationFrame(() => namePasswordRef.current?.focus());
      } else {
        setError(message);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="relative flex min-h-full w-full items-center justify-center overflow-hidden px-4 py-6">
      <LoginScene />
      <form
        onSubmit={submit}
        className="card fade-in relative z-10 w-full p-5 sm:p-7"
        style={{ maxWidth: "min(24rem, calc(100vw - 2rem))" }}
      >
        <div className="mb-6 flex flex-col items-center text-center">
          <div
            className="mb-3 grid h-14 w-14 place-items-center rounded-2xl"
            style={{ background: "var(--c-accent)", color: "#21301f" }}
          >
            <MessagesSquare size={28} />
          </div>
          <h1 className="font-display text-2xl font-semibold">{roomName}</h1>
          <p className="mt-1 text-sm text-[var(--c-muted)]">
            Room password first, your name after.
          </p>
        </div>

        <label className="mb-1 block text-xs font-medium text-[var(--c-muted)]">
          Display name
        </label>
        <input
          className="input mb-3"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. ada"
          autoComplete="nickname"
          autoFocus
          required
        />

        <label className="mb-1 block text-xs font-medium text-[var(--c-muted)]">
          Room password
        </label>
        <input
          className="input mb-3"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Room password"
          autoComplete="current-password"
          required
        />

        <div className="mb-3 overflow-hidden rounded-2xl border border-[var(--c-border)] bg-[color-mix(in_srgb,var(--c-bg)_62%,transparent)]">
          <button
            type="button"
            className="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left transition hover:bg-[var(--c-hover)]"
            onClick={() => setAdvanced((v) => !v)}
            aria-expanded={advanced}
            aria-controls="login-extra-credentials"
          >
            <span className="flex min-w-0 items-center gap-2.5">
              <span
                className="grid h-8 w-8 shrink-0 place-items-center rounded-xl"
                style={{ background: "var(--c-accent-soft)", color: "var(--c-accent)" }}
              >
                <KeyRound size={16} />
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-semibold leading-tight">
                  Reserved name or admin?
                </span>
                <span className="block truncate text-xs text-[var(--c-muted)]">
                  Add an optional extra password.
                </span>
              </span>
            </span>
            <ChevronDown
              size={16}
              className={`shrink-0 text-[var(--c-muted)] transition ${advanced ? "rotate-180" : ""}`}
            />
          </button>

          <div
            id="login-extra-credentials"
            className={`${advanced ? "block" : "hidden"} fade-in border-t border-[var(--c-border)] p-3`}
          >
            <div className="space-y-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-[var(--c-muted)]">
                  Reserved-name password
                </label>
                <input
                  ref={namePasswordRef}
                  className="input"
                  type="password"
                  value={namePassword}
                  onChange={(e) => setNamePassword(e.target.value)}
                  placeholder="Only for protected names"
                  autoComplete="current-password"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-[var(--c-muted)]">
                  Admin password
                </label>
                <input
                  className="input"
                  type="password"
                  value={adminPassword}
                  onChange={(e) => setAdminPassword(e.target.value)}
                  placeholder="Optional"
                  autoComplete="current-password"
                />
              </div>
            </div>
          </div>
        </div>

        {error && (
          <p className="mb-3 rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-300">
            {error}
          </p>
        )}

        <button className="btn btn-primary w-full" disabled={busy}>
          {busy ? "Joining…" : "Join room"}
        </button>
      </form>
    </div>
  );
}

/** A soft Ghibli-style scene: sun, drifting clouds, layered hills and a tree. */
function LoginScene() {
  return (
    <svg
      className="pointer-events-none absolute inset-0 h-full w-full"
      viewBox="0 0 1200 800"
      preserveAspectRatio="xMidYMax slice"
      aria-hidden="true"
    >
      <circle className="sun-glow" cx="930" cy="170" r="78" fill="var(--c-sun)" opacity="0.92" />
      <circle cx="930" cy="170" r="120" fill="var(--c-sun)" opacity="0.1" />

      <g fill="var(--c-cloud)">
        <g className="cloud">
          <ellipse cx="260" cy="170" rx="90" ry="26" />
          <ellipse cx="320" cy="150" rx="60" ry="24" />
          <ellipse cx="210" cy="155" rx="50" ry="20" />
        </g>
        <g className="cloud-slow">
          <ellipse cx="760" cy="300" rx="70" ry="20" />
          <ellipse cx="810" cy="285" rx="48" ry="18" />
        </g>
      </g>

      {/* Layered rolling hills */}
      <path d="M0 560 C 220 470 380 540 600 500 C 820 460 1000 540 1200 500 L1200 800 L0 800 Z" fill="var(--c-hill-1)" />
      <path d="M0 640 C 260 560 460 630 700 600 C 920 575 1080 630 1200 600 L1200 800 L0 800 Z" fill="var(--c-hill-2)" opacity="0.96" />
      <path d="M0 720 C 300 660 520 720 760 700 C 980 685 1100 715 1200 700 L1200 800 L0 800 Z" fill="var(--c-hill-3)" />

      {/* A lone tree on the near hill */}
      <g transform="translate(180 612)">
        <rect x="-6" y="0" width="12" height="60" rx="5" fill="var(--c-hill-3)" />
        <circle cx="0" cy="-14" r="40" fill="var(--c-hill-2)" />
        <circle cx="-28" cy="6" r="26" fill="var(--c-hill-2)" />
        <circle cx="26" cy="4" r="28" fill="var(--c-hill-2)" />
      </g>
    </svg>
  );
}
