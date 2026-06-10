# Conventus docs

A small, self-contained documentation site for Conventus.

- **`content.md`** — the source. Edit this. It also renders nicely on GitHub.
- **`template.html`** — the page shell (styling + marked + Mermaid).
- **`build.py`** — embeds `content.md` into `template.html` to produce
  **`index.html`**.
- **`index.html`** — the generated, self-contained page. The Markdown is
  embedded and rendered client-side ([marked](https://marked.js.org)), with
  ```` ```mermaid ```` blocks rendered as diagrams
  ([Mermaid](https://mermaid.js.org)).
- **`img/`** — screenshots referenced by the docs.

## View it

Just open `index.html` in a browser, or host the `docs/` folder anywhere static
(GitHub Pages, a Hugging Face Space, `python -m http.server`, …). The fonts,
marked and Mermaid load from a CDN, so an internet connection makes it look its
best.

## Rebuild after editing `content.md`

```bash
python docs/build.py
```

No Python locally? Build it with the project's container:

```bash
docker run --rm -v "$PWD/docs:/docs" python:3.12-slim python /docs/build.py
```
