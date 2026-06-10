---
name: conventus-docs
description: Write or regenerate Conventus documentation — the docs site (docs/content.md → index.html), the README feature list/Space card, the API reference, and capturing fresh screenshots. Use when documentation needs adding or updating after features change.
---

# Conventus — documentation

The project has three doc surfaces. Keep them in sync when features change.

## 1. The docs site (`docs/`)

- **`docs/content.md`** — the source. Edit this. (It also renders on GitHub.)
- **`docs/template.html`** — styled shell that loads `marked` + `mermaid`.
- **`docs/build.py`** — embeds `content.md` into the template → `docs/index.html`
  (self-contained; markdown rendered client-side).
- **`docs/img/`** — screenshots referenced from `content.md`.

After editing `content.md`, **regenerate**:

```bash
docker run --rm -v "$PWD/docs:/docs" python:3.12-slim python /docs/build.py
```

Conventions:
- Use `## `/`### ` headings; the page styles them in the solarpunk theme.
- Diagrams: fenced ` ```mermaid ` blocks (architecture, sequence, flow) —
  rendered to SVG at view time.
- Screenshots: `![alt](img/name.png)`. Add new ones to `docs/img/`.
- The API reference is a set of pipe tables grouped by area; mark admin-only
  routes with 🔒. Keep it matching the actual routers.
- **Do not** put a literal closing `</script>` in `content.md` (it would break
  the embed); `build.py` escapes it, but avoid it in prose anyway.

Verify by opening `docs/index.html` in headless Chrome (`--allow-file-access-from-files`)
and checking `document.images` all load and `.mermaid svg` count > 0.

## 2. README / Space card (`README.md`)

The root `README.md` doubles as the **Hugging Face Space card** — keep the YAML
front matter (`sdk: docker`, `app_port: 7860`, emoji/colors) intact, and keep
the feature list current. It is *not* baked into the Docker image, so README/docs
changes need **no rebuild**.

## 3. API docs

The FastAPI app's OpenAPI metadata lives in `backend/app/main.py`
(`API_DESCRIPTION`, `TAGS_METADATA`). When adding an endpoint: give its function
a docstring, ensure its router has a `tags=[…]`, and add a row to the API
reference in `docs/content.md`. Live docs are at `/docs` and `/redoc`.

## Fresh screenshots

Use the `conventus-dev` skill's headless-Chrome recipe (set the token in
localStorage, reload, `Page.captureScreenshot`). Phone shots: `--window-size=390,780`.
Copy the good ones into `docs/img/` before referencing them.
