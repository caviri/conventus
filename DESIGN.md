# DESIGN.md — Conventus design system & alternatives

Conventus's look is **token-driven**: a handful of CSS variables on `:root`
control the whole UI. Change the tokens and everything re-skins — themes, presets
and per-user custom CSS all work by overriding the same variables.

## Where the tokens live

- **Base (dark default)** — `frontend/src/index.css` `:root { … }`.
- **Light theme** — `frontend/src/theme.ts` (`LIGHT` string, injected into a
  `<style id="conventus-theme">` that sits *before* the user-CSS slot).
- **Settings presets** — `frontend/src/components/Settings.tsx` (`PRESETS`).
- **Per-user custom CSS** — Settings → Appearance, stored in `localStorage`,
  injected into `<style id="conventus-user-css">` (loads *last*, so it always
  wins). See the cascade order below.

**Cascade (low → high):** base stylesheet → `#conventus-theme` (light/dark) →
`#conventus-user-css` (user). Never make a theme rule out-specify `:root` or you'll
break user overrides.

## The tokens

| Variable          | Controls                                   |
| ----------------- | ------------------------------------------ |
| `--c-bg`          | App background                             |
| `--c-surface`     | Sidebar / headers                          |
| `--c-surface-2`   | Cards, composer                            |
| `--c-elevated`    | Buttons, hovered rows                      |
| `--c-border`      | Borders / dividers                         |
| `--c-text`        | Primary text                               |
| `--c-muted`       | Secondary text                             |
| `--c-accent`      | Primary accent (buttons, links, mentions)  |
| `--c-accent-2`    | Secondary accent (gradients)               |
| `--c-accent-soft` | Translucent accent (highlights, flashes)   |
| `--c-hover`       | Row-hover overlay                          |
| `--c-backdrop`    | Body background (gradients ok)             |
| `--c-sun`, `--c-hill-1/2/3`, `--c-cloud` | Login-scene illustration |
| `--radius`        | Corner roundness                           |
| `--font`          | Body font                                  |
| `--font-display`  | Heading / brand font                       |

## Current aesthetic — solarpunk · Ghibli

Warm, sunlit, organic. **Dark = "forest dusk"** (deep greens lit by lantern
gold); **light = "meadow day"** (cream parchment, sage, leaf green, sunlit sky).
Storybook serif (**Fraunces**) for the brand/headings, rounded **Nunito** body,
generous radius, pill buttons with a duotone accent gradient, soft warm shadows,
an illustrated login scene and empty states.

Built-in presets: *Forest Dusk, Meadow Day, Golden Hour, Mossy Glen, Sakura,
Twilight*.

## Alternative directions

Each is a drop-in `:root { … }` — paste into Settings → Custom CSS to try, or
adopt as a new preset / the base theme. Pair with a matching `--font` if you want
to fully change the character.

### Midnight Glass (cool, minimal)
```css
:root {
  --c-bg:#0a0e17; --c-surface:#10151f; --c-surface-2:#151b28;
  --c-elevated:#1c2434; --c-border:#283246; --c-text:#e7ecf5; --c-muted:#8893a8;
  --c-accent:#6aa2ff; --c-accent-2:#a98cff; --c-accent-soft:#6aa2ff26;
  --radius:14px;
}
```

### Terminal / Retro (monospace, phosphor)
```css
@import url("https://fonts.googleapis.com/css2?family=IBM+Plex+Mono&display=swap");
:root {
  --c-bg:#0b0f0b; --c-surface:#0f150f; --c-surface-2:#121a12;
  --c-elevated:#162016; --c-border:#1f2d1f; --c-text:#c9f7c9; --c-muted:#6f9e6f;
  --c-accent:#39ff14; --c-accent-2:#9bff6a; --c-accent-soft:#39ff1422;
  --radius:4px; --font:"IBM Plex Mono", monospace; --font-display:"IBM Plex Mono", monospace;
}
```

### Neo-Brutalist (high contrast, hard edges)
```css
@import url("https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;700&display=swap");
:root {
  --c-bg:#f4f4ee; --c-surface:#ffffff; --c-surface-2:#ffffff; --c-elevated:#fff3c4;
  --c-border:#111111; --c-text:#111111; --c-muted:#555555;
  --c-accent:#ff4d3d; --c-accent-2:#ffd23f; --c-accent-soft:#ff4d3d20;
  --radius:0px; --font:"Space Grotesk", sans-serif; --font-display:"Space Grotesk", sans-serif;
}
/* brutalist hard shadows */
.card,.btn{ box-shadow:4px 4px 0 var(--c-border) !important; }
```

### Sakura Day (soft pastel)
```css
:root {
  --c-bg:#f6e9ec; --c-surface:#fdf4f6; --c-surface-2:#f9eef1; --c-elevated:#f1dde3;
  --c-border:#e8cdd6; --c-text:#3f2e34; --c-muted:#8a6f78;
  --c-accent:#e57aa0; --c-accent-2:#8cbf7a; --c-accent-soft:#e57aa026;
}
```

### Deep Ocean (cool dark, teal)
```css
:root {
  --c-bg:#06141b; --c-surface:#0a1e29; --c-surface-2:#0d2734; --c-elevated:#123442;
  --c-border:#1c4452; --c-text:#e3f2f4; --c-muted:#8db1bb;
  --c-accent:#2ec4b6; --c-accent-2:#48bfe3; --c-accent-soft:#2ec4b626;
}
```

## Guidelines for new themes

- Keep **text/background contrast** ≥ ~7:1 for body text.
- `--c-surface` should read as slightly distinct from `--c-bg` (panels lift off
  the canvas); `--c-elevated` a touch brighter again.
- Make `--c-accent-soft` the accent at ~15–20% alpha (used for mention
  highlights, the message "flash", and active nav).
- `--c-backdrop` may use gradients; on mobile it's `background-attachment: fixed`
  — keep it cheap.
- Code blocks are intentionally a **fixed dark surface** in both themes (so the
  syntax theme stays readable); don't tie them to `--c-bg`.
- Test both **light and dark**, and a **390px phone** width.
