# 06 — Import Playlist write + already_on_sc

**What to build:** Accepted Match Records are written to one dated Import Playlist on SoundCloud. Tracks already present on the user’s SoundCloud still go into the playlist and are flagged `already_on_sc` on the Match Record.

**Blocked by:** 05 — Resolve Ambiguous + Unresolved (listen / pick / search / skip)

**Status:** ready-for-human

- [x] Create Import Playlist with a clear naming convention (e.g. dated VK import)
- [x] Add all accepted SoundCloud Tracks (Auto + user-resolved), not likes-as-destination
- [x] Detect and flag `already_on_sc` while still adding to the playlist
- [x] Session File stores Import Playlist identity and flags
- [x] Seam tests assert playlist create/add calls and already_on_sc via fake gateway
- [x] Rate-limit-friendly pacing for large add batches (basic)

## Comments

- Implemented: `writeImportPlaylist` on Import Session API; SoundCloudGateway `createPlaylist` / `setPlaylistTracks` / `listLikedTrackIds`; Session File `importPlaylist` + `alreadyOnSc`; NDJSON `POST /api/session/playlist`; shell Write CTA. Seam: `import-playlist.seam.spec.ts`.
