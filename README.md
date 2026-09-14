# vk-sc-import

Local SvelteKit tool that catalog-matches a **Source Library** of VK likes into a SoundCloud **Import Playlist**. Matching is catalog-only (search + score) — not audio download or re-upload.

## Prerequisites

- [Node.js](https://nodejs.org/) 20 or newer (LTS recommended)
- npm (ships with Node)

## Install → start → open

From this repo:

```sh
npm install
npm run dev
```

Then open the URL Vite prints (usually [http://localhost:5173](http://localhost:5173)).

To open a browser tab automatically:

```sh
npm run dev -- --open
```

## What you will see

The landing page defaults to **Russian** UI copy (switchable to English). SoundCloud starts disconnected. You can upload or paste a **Source Library** (JSON preferred, CSV accepted) with `artist` + `title` per Library Track. Valid rows create an **Import Session** stored in `.data/session.json` on disk so a reload restores the library; invalid rows are reported and skipped. SoundCloud connect lands in a later build.

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
