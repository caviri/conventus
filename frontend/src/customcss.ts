// Per-browser look-and-feel customization. The CSS the user writes lives only
// in localStorage (never on the server) and is injected into a <style> tag, so
// each person can reskin their own Conventus without affecting anyone else.
const KEY = "conventus.customcss";
const STYLE_ID = "conventus-user-css";

export function getCustomCss(): string {
  return localStorage.getItem(KEY) || "";
}

export function applyCustomCss(css: string) {
  const el = document.getElementById(STYLE_ID);
  if (el) el.textContent = css;
}

export function saveCustomCss(css: string) {
  localStorage.setItem(KEY, css);
  applyCustomCss(css);
}

export function loadCustomCss() {
  applyCustomCss(getCustomCss());
}
