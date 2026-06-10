#!/usr/bin/env python3
"""Render docs/content.md into a self-contained docs/index.html.

The markdown is embedded into the page (so index.html works even from file://),
and rendered client-side by marked + mermaid. Re-run this after editing
content.md:

    python docs/build.py
"""
from pathlib import Path

HERE = Path(__file__).parent


def main() -> None:
    md = (HERE / "content.md").read_text(encoding="utf-8")
    template = (HERE / "template.html").read_text(encoding="utf-8")
    # Guard against a literal closing-script tag breaking the embed.
    md_safe = md.replace("</script>", "<\\/script>")
    html = template.replace("__MARKDOWN__", md_safe)
    (HERE / "index.html").write_text(html, encoding="utf-8")
    print(f"Wrote {HERE / 'index.html'} ({len(html):,} bytes)")


if __name__ == "__main__":
    main()
