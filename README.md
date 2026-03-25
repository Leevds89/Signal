# Klopkruis Signal

Klopkruis Signal is a realtime website MVP built with Express, Socket.IO, and SQLite.

It now includes:

- a richer public landing page
- realtime signal visuals and participation stats
- a launch brief form that stores submissions in SQLite
- an admin control room at `/admin`
- password-based admin auth with signed cookies
- deployment helpers for Docker and environment-based configuration

## Local run

1. Create a `.env` file from `.env.example` if you want custom credentials.
2. Install dependencies with `npm install`.
3. Start the app with `npm start`.
4. Open `http://localhost:3000`.
5. Open `http://localhost:3000/admin` for the control room.

If you do not set `ADMIN_PASSWORD` and `SESSION_SECRET`, the app uses local development defaults and warns on startup.

## Environment variables

The server reads values from process environment variables and from a local `.env` file if present.

- `PORT` defaults to `3000`
- `NODE_ENV` defaults to development behavior locally. Use `production` on your live HTTPS host.
- `ADMIN_PASSWORD` controls admin login
- `SESSION_SECRET` signs the admin session cookie
- `SQLITE_PATH` defaults to `data/signal.sqlite`

## Deployment notes

- Use a real `ADMIN_PASSWORD` and a long random `SESSION_SECRET` before going live.
- Mount persistent storage for the SQLite file in production.
- Point health checks to `/health`.
- The included `Dockerfile` works well for services like Render, Railway, Fly.io, or any Docker host.

## Recommended live path: Render

I set this project up for Render because it fits this app well:

- Render supports Docker web services.
- Render Blueprints support `healthCheckPath` for web services.
- Render Blueprints also support attached persistent disks, which is important because this app stores submissions in SQLite.

This repo now includes `render.yaml`, so the deployment path is:

1. Push this folder to a GitHub repo.
2. In Render, create a new Blueprint from that repo.
3. When Render prompts for `ADMIN_PASSWORD`, enter `KillaB89@`.
4. Let Render generate `SESSION_SECRET` automatically.
5. Deploy the service and wait for the health check on `/health` to pass.
6. Open the generated `.onrender.com` URL and test `/` plus `/admin`.

The Blueprint is configured to:

- run the app as a Docker web service
- set `NODE_ENV=production`
- set `PORT=10000`
- store SQLite at `/app/data/signal.sqlite`
- attach a persistent disk at `/app/data`

Important:

- The local `.env` file is only for your machine. Do not upload it publicly.
- Render will ask for the admin password because `render.yaml` keeps it out of the repo on purpose.
- Because the app uses SQLite, keep the persistent disk attached or submissions will not survive redeploys.

## Smoke test checklist

- Public page loads at `/`
- Health responds at `/health`
- Form submissions create rows in SQLite
- Admin login works
- Submission status updates save from the control room
