"""Best-effort OpenGraph/oEmbed link previews.

When a message contains URLs we fetch them in the background, scrape a little
OpenGraph metadata, and patch the message so clients can render a rich card.
Everything here is defensive: a preview failing must never break a message.
"""
from __future__ import annotations

import re
from typing import Any, Optional
from urllib.parse import urljoin, urlparse

import httpx
from bs4 import BeautifulSoup

URL_RE = re.compile(r"https?://[^\s<>\"']+", re.IGNORECASE)

_HEADERS = {
    "User-Agent": "Mozilla/5.0 (compatible; ConventusBot/0.1; +https://conventus.local)",
    "Accept": "text/html,application/xhtml+xml",
}


def extract_urls(text: str, limit: int = 4) -> list[str]:
    seen: list[str] = []
    for match in URL_RE.findall(text or ""):
        url = match.rstrip(".,);]")
        if url not in seen:
            seen.append(url)
        if len(seen) >= limit:
            break
    return seen


def _meta(soup: BeautifulSoup, *names: str) -> Optional[str]:
    for name in names:
        tag = soup.find("meta", attrs={"property": name}) or soup.find(
            "meta", attrs={"name": name}
        )
        if tag and tag.get("content"):
            return tag["content"].strip()
    return None


async def fetch_preview(url: str) -> Optional[dict[str, Any]]:
    try:
        async with httpx.AsyncClient(
            follow_redirects=True, timeout=8.0, headers=_HEADERS
        ) as client:
            resp = await client.get(url)
            content_type = resp.headers.get("content-type", "")
            if resp.status_code >= 400:
                return None

            if content_type.startswith("image/"):
                return {"url": url, "type": "image", "image": url}

            # Direct video files (webm/mp4/ogg) become inline players.
            if content_type.startswith("video/"):
                return {
                    "url": url,
                    "type": "video",
                    "video": url,
                    "mime": content_type.split(";")[0].strip(),
                }

            if not content_type.startswith("text/html"):
                return {
                    "url": url,
                    "type": "link",
                    "title": urlparse(url).netloc,
                    "site": urlparse(url).netloc,
                }

            soup = BeautifulSoup(resp.text, "html.parser")
            title = _meta(soup, "og:title", "twitter:title") or (
                soup.title.string.strip() if soup.title and soup.title.string else None
            )
            description = _meta(
                soup, "og:description", "twitter:description", "description"
            )
            image = _meta(soup, "og:image", "twitter:image")
            if image:
                image = urljoin(url, image)
            site = _meta(soup, "og:site_name") or urlparse(url).netloc

            # GIF hosts (Giphy, Tenor, …) expose the animation as og:video
            # (mp4/webm) — render it as an autoplaying, looping inline player.
            video = _meta(
                soup,
                "og:video:secure_url",
                "og:video:url",
                "og:video",
                "twitter:player:stream",
            )
            if video and re.search(r"\.(mp4|webm)(\?|$)", video, re.IGNORECASE):
                return {
                    "url": url,
                    "type": "video",
                    "video": urljoin(url, video),
                    "image": image,
                    "site": site,
                }

            # A page whose preview image is itself a GIF → show it animated.
            if image and re.search(r"\.gif(\?|$)", image, re.IGNORECASE):
                return {"url": url, "type": "image", "image": image}

            if not (title or description or image):
                return None

            return {
                "url": url,
                "type": "link",
                "title": title or site,
                "description": description,
                "image": image,
                "site": site,
            }
    except Exception:
        return None


async def fetch_all(urls: list[str]) -> list[dict[str, Any]]:
    previews: list[dict[str, Any]] = []
    for url in urls:
        preview = await fetch_preview(url)
        if preview:
            previews.append(preview)
    return previews
