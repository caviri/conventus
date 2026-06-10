# Deploying Conventus to a Hugging Face Space

Conventus is a single Docker container, so a **Docker Space** runs it as-is. The
GitHub Action prepends `hf-space-header.yml` to `README.md` before syncing; that
header (`sdk: docker`, `app_port: 7860`) is all the config the Space needs.

## Option A — manual (one push)

1. Create a new Space → **Docker** SDK (blank), say `your-name/conventus`.
2. Push this repo to it:
   ```bash
   git worktree add ../conventus-hf main
   cd ../conventus-hf
   cat hf-space-header.yml README.md > README.hf.md
   mv README.hf.md README.md
   git remote add space https://huggingface.co/spaces/your-name/conventus
   git add README.md
   git commit -m "Prepare Hugging Face Space README"
   git push space HEAD:main
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

## Notes

- **HTTPS is automatic** on Spaces, which is required for the installable PWA,
  service worker, and **Web Push** delivery. (Push can only be verified on a
  real HTTPS deployment with a real device — localhost can't exercise the final
  delivery hop.)
- To verify after deploy: open the URL on a phone, **Install** from Settings,
  enable notifications, and have someone `@mention` you while the app is closed.
