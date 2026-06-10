# Conventus themes

The CSS for every built-in preset, in readable form — each theme comes as a
**dark / light pair**. Use them as reference or as a starting point for your
own look.

| Theme       | Dark variant                         | Light variant                          |
| ----------- | ------------------------------------ | -------------------------------------- |
| Forest      | [Forest Dusk](forest-dusk.css)       | [Meadow Day](meadow-day.css)           |
| Golden Hour | [Golden Hour](golden-hour.css)       | [Golden Morning](golden-morning.css)   |
| Mossy Glen  | [Mossy Glen](mossy-glen.css)         | [Misty Glen](misty-glen.css)           |
| Sakura      | [Sakura Night](sakura-night.css)     | [Sakura Day](sakura-day.css)           |
| Twilight    | [Twilight](twilight.css)             | [Lavender Day](lavender-day.css)       |

## How to use one

Open **Settings → Appearance — Custom CSS** in Conventus, paste the contents of
a file, and tweak away. Custom CSS is stored only in your browser and always
wins over the active theme, so it's a safe sandbox.

The same palettes are available as one-click presets in that section — these
files exist so you can read, remix, and build on them.

## The tokens

Everything is driven by CSS variables on `:root` (see [`DESIGN.md`](../DESIGN.md)
for the full design system):

```
--c-bg --c-surface --c-surface-2 --c-elevated --c-border
--c-text --c-muted
--c-accent --c-accent-2 --c-accent-soft --c-hover
--c-backdrop --radius --font --font-display
```

Guidelines for a good theme:

- Body text contrast ≥ ~7:1; `--c-surface` slightly distinct from `--c-bg`.
- `--c-accent-soft` = the accent at ~15–20% alpha.
- `--c-backdrop` can be a gradient — keep it cheap, it's fixed on mobile.
