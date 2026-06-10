// Light / dark theme. The chosen theme's variables are injected into a
// <style id="conventus-theme"> element that sits *before* the user-CSS slot in
// the DOM, so: base defaults < theme < user custom CSS. That ordering means a
// person's custom CSS still overrides the active theme.
const KEY = "conventus.theme";
const STYLE_ID = "conventus-theme";

export type Theme = "dark" | "light";

// "Meadow day" — warm cream parchment, sage panels, leaf-green light, with a
// sunlit sky-and-hills backdrop.
const LIGHT = `:root{
  --c-bg:#f1ead3;
  --c-surface:#fcf7e8;
  --c-surface-2:#f7f0da;
  --c-elevated:#ece1c1;
  --c-border:#dccfa6;
  --c-text:#2f3a27;
  --c-muted:#6f7c58;
  --c-accent:#4f9a5b;
  --c-accent-2:#e3a93f;
  --c-accent-soft:#4f9a5b26;
  --c-hover:rgba(58,74,34,0.05);
  --c-sun:#f4c44e;
  --c-hill-1:#9ccb76;
  --c-hill-2:#6fa657;
  --c-hill-3:#4f8a4a;
  --c-cloud:rgba(255,255,255,0.72);
  --c-backdrop:radial-gradient(840px 460px at 82% -14%, #ffe3a0cc, transparent 60%),
    radial-gradient(720px 540px at 6% 114%, #bfe0a9cc, transparent 60%),
    linear-gradient(180deg,#eef3da,#f1ead3 62%);
}`;

export function getTheme(): Theme {
  return localStorage.getItem(KEY) === "light" ? "light" : "dark";
}

export function applyTheme(theme: Theme) {
  const el = document.getElementById(STYLE_ID);
  if (el) el.textContent = theme === "light" ? LIGHT : "";
  document.documentElement.dataset.theme = theme;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", theme === "light" ? "#f1ead3" : "#14211a");
}

export function setTheme(theme: Theme) {
  localStorage.setItem(KEY, theme);
  applyTheme(theme);
}

export function loadTheme() {
  applyTheme(getTheme());
}

export function toggleTheme(): Theme {
  const next: Theme = getTheme() === "light" ? "dark" : "light";
  setTheme(next);
  return next;
}
