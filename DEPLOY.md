# Deploying Conventus to a Hugging Face Space

Conventus is a single Docker container, so a **Docker Space** runs it as-is. The
GitHub Action prepends `hf-space-header.yml` to `README.md` before syncing; that
header (`sdk: docker`, `app_port: 7860`) is all the config the Space needs. The
Action publishes a clean orphan snapshot and strips `docs/img` because Hugging
Face's plain Space git remote rejects binary screenshots unless they are stored
with Xet/LFS.

## Option A — manual (one push)

1. Create a new Space → **Docker** SDK (blank), say `your-name/conventus`.
2. Push this repo to it:
   ```bash
   git worktree add ../conventus-hf main
   cd ../conventus-hf
   git checkout --orphan hf-deploy
   git rm -rf --cached . >/dev/null
   cat hf-space-header.yml README.md > README.hf.md
   mv README.hf.md README.md
   RAW_BASE="https://raw.githubusercontent.com/your-github-user/conventus/$(git rev-parse main)"
   sed -i -E "s#src=\"docs/img/#src=\"${RAW_BASE}/docs/img/#g" README.md
   sed -i -E "s#\]\(img/#](${RAW_BASE}/docs/img/#g" docs/content.md docs/index.html
   rm -rf docs/img
   git remote add space https://huggingface.co/spaces/your-name/conventus
   git add -A
   git commit -m "Deploy snapshot"
   git push --force space hf-deploy:main
   ```
   (When prompted, use your HF username and a **write** token from
   <https://huggingface.co/settings/tokens> as the password.)
3. In the Space's **Settings → Variables and secrets**, add secrets:
   - `ROOM_PASSWORD`, `ADMIN_PASSWORD`, `SECRET_KEY` (e.g. `openssl rand -hex 32`).
   - Optional: `ROOM_NAME`, `MAX_UPLOAD_MB`.
4. (Recommended) Enable **persistent storage** so the room + uploads survive
   restarts — it mounts at `/data`.

The Space builds the container and serves the app at
`https://your-name-conventus.hf.space`.

## Option B — auto-deploy on every push (GitHub Action)

This repo ships `.github/workflows/deploy-hf.yml`, which force-pushes to the
Space whenever you push to `main`.

1. Create the Docker Space (as above). This repository's workflow deploys to
   `katospiegel/conventus`.
2. In your **GitHub repo → Settings → Secrets and variables → Actions**:
   - **Secret** `HF_TOKEN` — a write token from HF.
3. Set `ROOM_PASSWORD` / `ADMIN_PASSWORD` / `SECRET_KEY` as **Space** secrets
   (step A.3) — these live on HF, not in GitHub.
4. Push to `main` → the Action deploys → the Space rebuilds.

## Call rooms (TURN)

Call rooms are a **WebRTC mesh**: audio and video stream peer-to-peer and the
container only relays signaling. Two things matter for a real deployment:

- **HTTPS is required** for the browser to grant mic/camera access — same as the
  PWA and push. Spaces provide it automatically; self-hosting elsewhere, put the
  app behind TLS (a reverse proxy / `https://`).
- **NAT traversal.** The default `STUN_URLS` (Google's public STUN) connects
  peers on most home/office networks. Users behind **strict or symmetric NATs**
  (some corporate/mobile networks) can't connect without a **TURN relay**, which
  this container doesn't run. Point it at one with these env vars / Space secrets:

  | Variable        | Example                              |
  | --------------- | ------------------------------------ |
  | `STUN_URLS`     | `stun:stun.l.google.com:19302`       |
  | `TURN_URLS`     | `turn:turn.example.com:3478`         |
  | `TURN_USERNAME` | `conventus`                          |
  | `TURN_PASSWORD` | a strong shared secret               |

  `STUN_URLS` / `TURN_URLS` accept a comma-separated list. A common self-hosted
  TURN server is **[coturn](https://github.com/coturn/coturn)** — e.g. run it
  alongside the app and set, in its config, `lt-cred-mech` with a matching
  `user=conventus:<password>` and `realm`. The browser fetches this ICE config
  at join time from `GET /api/auth/config`.

A mesh is sized for **small groups** (~4–6 people). Larger calls would need a
media server (SFU), which this single-container app deliberately doesn't run.

## Notes

- **HTTPS is automatic** on Spaces, which is required for the installable PWA,
  service worker, **Web Push** delivery, and **call-room** mic/camera access.
  (Push can only be verified on a real HTTPS deployment with a real device —
  localhost can't exercise the final delivery hop.)
- To verify after deploy: open the URL on a phone, **Install** from Settings,
  enable notifications, and have someone `@mention` you while the app is closed.
