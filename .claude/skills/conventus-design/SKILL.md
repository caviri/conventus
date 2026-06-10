---
name: conventus-design
description: Restyle Conventus or add a new theme/preset. Use when changing the look — palette, fonts, radius, the login illustration — or creating theme presets and custom-CSS snippets. The UI is fully token-driven; see DESIGN.md for the full system and ready-made alternative palettes.
---

# Conventus — design & theming

The entire UI is driven by **CSS variables** on `:root`. Change the tokens and
everything re-skins. Full reference and ready-to-paste alternative palettes are
in **`DESIGN.md`** — read it first.

## Where to change things

| Goal                              | Edit                                                        |
| --------------------------------- | ----------------------------------------------------------- |
| The **default dark** theme        | `frontend/src/index.css` `:root { … }`                      |
| The **light** theme               | `frontend/src/theme.ts` (`LIGHT` string)                    |
| **Settings presets**              | `frontend/src/components/Settings.tsx` (`PRESETS`)          |
| Reusable component styles         | `frontend/src/index.css` (`.btn`, `.card`, `.input`, …)     |
| The **login illustration**        | `frontend/src/components/Login.tsx` (`LoginScene` SVG) + the `--c-sun/--c-hill-*` tokens |

A user's **custom CSS** (Settings → Appearance) is injected last and must keep
winning over themes — never make a theme rule out-specify `:root`. Cascade:
base → `#conventus-theme` → `#conventus-user-css`.

## The tokens

`--c-bg --c-surface --c-surface-2 --c-elevated --c-border --c-text --c-muted
--c-accent --c-accent-2 --c-accent-soft --c-hover --c-backdrop --radius --font
--font-display` (plus `--c-sun --c-hill-1/2/3 --c-cloud` for the login scene).

## Add a new preset

In `PRESETS` (Settings.tsx), add `"<Name>": ":root{--c-bg:…;--c-accent:…; … }"`.
Keep `--c-accent-soft` at the accent ~15–20% alpha, and set `--c-backdrop` (a
gradient is fine). Include `--c-accent-2` for button gradients.

## Make a whole new look

1. Pick a palette (or grab one from `DESIGN.md`: Midnight Glass, Terminal/Retro,
   Neo-Brutalist, Sakura Day, Deep Ocean).
2. To change it for everyone, edit the base `:root` (dark) and `theme.ts` (light).
   To offer it, add a preset. To try it instantly, paste into Settings → Custom CSS.
3. Optionally set `--font` / `--font-display` (load web fonts with `@import`).

## Quality bar

- Body text contrast ≥ ~7:1; panels (`--c-surface`) distinct from `--c-bg`.
- Code blocks stay a fixed dark surface in both themes — don't tie them to
  `--c-bg`.
- Verify **light + dark** and a **390px phone**. Rebuild
  (`docker build -t conventus:test .`) and screenshot via the `conventus-dev`
  recipe before committing.
