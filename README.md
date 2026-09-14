# vk-sc-import

Local SvelteKit tool that catalog-matches a **Source Library** of VK likes into a SoundCloud **Import Playlist**. Matching is catalog-only (search + score) — not audio download or re-upload.

## Prerequisites

- [Node.js](https://nodejs.org/) 20 or newer (LTS recommended)
- npm (ships with Node)
- A SoundCloud API application (client id) for OAuth — see [SoundCloud connect](#soundcloud-connect) below

## Install → start → open

From this repo:

```sh
npm install
cp .env.example .env
# edit .env: set SOUNDCLOUD_CLIENT_ID and usually SOUNDCLOUD_CLIENT_SECRET
npm run dev
```

Then open the URL Vite prints (usually [http://localhost:5173](http://localhost:5173)).

To open a browser tab automatically:

```sh
npm run dev -- --open
```

## SoundCloud connect

1. Register a personal app in the [SoundCloud developers](https://developers.soundcloud.com/) / apps area and copy the **client id**.
2. Set the app’s redirect URI to exactly  
   `http://localhost:5173/auth/soundcloud/callback`  
   (or the same path on whatever host/port you use — must match `SOUNDCLOUD_REDIRECT_URI` in `.env`).
3. Put the **client id** in `.env` as `SOUNDCLOUD_CLIENT_ID`, and usually also the **client secret** as `SOUNDCLOUD_CLIENT_SECRET`. SoundCloud still treats most apps as confidential: without a secret, token exchange often returns `invalid_client` after you approve access in the browser. Prefer not committing the secret; keep it only in local `.env`. If you want secret-less PKCE, ask SoundCloud to mark the app as **public**, then you can omit `SOUNDCLOUD_CLIENT_SECRET`.
4. Tokens and identity are stored under `.data/soundcloud-auth.json` on this machine only — not a hosted SaaS.

## What you will see

The landing page defaults to **Russian** UI copy (switchable to English). Use **Connect SoundCloud** to sign in via the browser; the shell shows your username when connected, and **Disconnect** clears local tokens. You can upload or paste a **Source Library** (JSON preferred, CSV accepted) with `artist` + `title` per Library Track. Valid rows create an **Import Session** stored in `.data/session.json` on disk so a reload restores the library; invalid rows are reported and skipped.

## Out of scope

This project does **not**:

- Integrate FreeYourMusic (desktop or MCP)
- Download VK audio or re-upload files to SoundCloud
- Host a multi-user SaaS — it runs on your machine (localhost) only

## Scripts

| Command           | Purpose                          |
| ----------------- | -------------------------------- |
| `npm run dev`     | Local app on localhost           |
| `npm run check`   | Typecheck (svelte-check)         |
| `npm test`        | Unit tests (Vitest)              |
| `npm run build`   | Production build                 |
| `npm run preview` | Preview the production build     |
