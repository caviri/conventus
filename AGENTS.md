# AGENTS.md — working on Conventus

Guidance for AI agents (and humans) contributing to **Conventus**, an ephemeral,
self-hostable, Slack-like room that ships as a single Docker container.

## What this is

- **Backend** — FastAPI (uvicorn), SQLite (WAL) + files on disk. Serves a REST
  API, a presence/message **WebSocket** (`/ws`), a **Yjs collaboration relay**
  (`/collab/{doc}`), Web Push, and the built SPA as static files.
- **Frontend** — React 18 + Vite + TypeScript + Tailwind v4 + Zustand, plus Yjs
  for the collaborative canvas/whiteboard. PWA (service worker + manifest).
- **One container.** Multi-stage Docker builds the SPA, then FastAPI serves it
  on port **7860**. State lives in `DATA_DIR` (default `/data`).

## Layout

```
backend/app/
  main.py        FastAPI app, WebSocket + /collab endpoints, SPA serving, OpenAPI
  config.py      env-driven settings
  db.py          tiny SQLite layer (schema, migrations, pragmas)
  deps.py        auth dependencies (bearer token)
  security.py    password hashing + signed session tokens
  messaging.py   message create/serialize, link previews, mentions, push
  ws.py          WebSocket presence/broadcast hub
  collab.py      Yjs relay (binary frames, persistent log, compaction)
  webpush.py     VAPID keys + pywebpush delivery
  bots.py        OpenAI-compatible streaming bots
  previews.py    OpenGraph link previews
  games.py       per-game-type rules (bingo) for game boards
  routers/       auth, channels, dms, messages, members, search, boards,
                 games, files, bots, push, admin
frontend/src/
  store.ts       Zustand store (state + WS event handling)
  api.ts         fetch wrapper (bearer token)
  ws.ts          reconnecting WebSocket
  collab.ts      Yjs provider over /collab
  components/     UI (ChatView, Sidebar, Canvas, Whiteboard, Settings, …)
docs/            content.md + template.html + build.py → index.html (+ img/)
Dockerfile, docker-compose.yml, DEPLOY.md, DESIGN.md
```

## Build · run · test

**Run it:** `docker compose up --build` → http://localhost:7860 (room password
`conventus`, admin `admin`).

**This sandbox has no local Python or Node — use Docker for everything:**

- **Build:** `docker build -t conventus:test .`
- **Run:** `docker run -d --name conventus-test -p 8899:7860 -e ROOM_PASSWORD=conventus -e ADMIN_PASSWORD=admin -e SECRET_KEY=test conventus:test`
- **API tests:** `curl` against `http://localhost:8899`. Log in for a token, then
  `Authorization: Bearer <token>`.
- **Run a Python script** (e.g. `docs/build.py`) without local Python:
  `docker run --rm -v "$PWD/docs:/docs" python:3.12-slim python /docs/build.py`
  (the app image `conventus:test` also has pyyaml, for validating workflows).
- **Screenshot the UI** with headless Chrome over the DevTools Protocol: launch
  `chrome --headless=new --remote-debugging-port=PORT --user-data-dir=… URL`,
  connect to the page's `webSocketDebuggerUrl`, set the auth token via
  `Runtime.evaluate` (`localStorage.setItem('conventus.token', …)`), reload,
  then `Page.captureScreenshot`. Emulate phones with `--window-size=390,780`.

**Always verify a change in the running container before committing.**

## Gotchas (learned the hard way)

- **CRLF + Edit:** the `Edit` tool occasionally can't match multi-line strings in
  some files (notably `frontend/src/format.ts`). If an edit fails on content you
  can see, fall back to a single-line edit or rewrite the whole file with `Write`.
- **PowerShell command guard:** scripts that combine a quoted `C:\Program Files`
  path with `docker rm`/delete tokens can be blocked as "destructive". Run
  `docker rm -f …` on its own line (or via the Bash tool), separate from CDP code.
- **Emoji in shells:** bash/PowerShell mangle emoji in terminal *display* (shows
  `??`) — the stored bytes are fine. To POST emoji reliably, write a UTF-8 JSON
  file and `curl --data-binary @file`.
- **React-controlled inputs in CDP:** set values via the native setter +
  `dispatchEvent(new Event('input',{bubbles:true}))`, not `el.value=`.
- **Selectors:** the sidebar and message list both use `.flex-1.overflow-y-auto`;
  the message list is `.overflow-y-auto.py-4`.

## Conventions

- Branch is **`main`**. Commit only when work is verified.
- End commit messages with the project's `Co-Authored-By` trailer.
- Keep the **single-container** invariant: no new external services. SQLite +
  files on disk is the datastore; the room is meant to be disposable.
- New REST endpoints: add a Pydantic request model, a router under
  `backend/app/routers/`, register it in `main.py`, and document it in
  `docs/content.md`'s API reference.
- The whole look is driven by CSS variables — see **DESIGN.md**. Per-user custom
  CSS must keep winning over the theme.

## Companion skills

`.claude/skills/` has task-specific helpers: `conventus-dev` (build/run/test),
`conventus-admin` (admin actions via the API), `conventus-docs` (write/regenerate
docs), and `conventus-design` (restyle / new themes).

## Known limitations / TODO

Call rooms are a **WebRTC mesh** (`backend/app/voice.py` relays signaling only;
`frontend/src/components/Room.tsx` runs the peer connections). Continuous audio +
video stream peer-to-peer; the browser keeps each peer's audio lip-synced to
their video. This also sidesteps the old `MediaRecorder` codec-interop and
iOS-autoplay problems (WebRTC negotiates a common codec and plays through a
gesture-unlocked `<video>`).

- **NAT traversal needs STUN, sometimes TURN.** Peers exchange addresses via STUN
  (default `stun:stun.l.google.com:19302`). That works across most home/office
  NATs, but users behind **symmetric NAT or strict firewalls** can't connect
  without a **TURN relay**. There's no TURN by default — set `TURN_URLS`
  (+ `TURN_USERNAME`/`TURN_PASSWORD`, and override `STUN_URLS` if desired) to
  point at one. ICE config is delivered to the browser via `GET /api/auth/config`.
- **Mesh scaling.** Every participant uploads their stream to every other
  participant, so upstream bandwidth grows with room size — fine for ~4–6 people,
  not a 50-person town hall. A bigger room would need an SFU (a media server that
  forwards streams), which this single-container app deliberately doesn't run.
