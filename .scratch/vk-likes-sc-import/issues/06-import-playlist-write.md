# 06 — Import Playlist write + already_on_sc

**What to build:** Accepted Match Records are written to one dated Import Playlist on SoundCloud. Tracks already present on the user’s SoundCloud still go into the playlist and are flagged `already_on_sc` on the Match Record.

**Blocked by:** 05 — Resolve Ambiguous + Unresolved (listen / pick / search / skip)

**Status:** ready-for-agent

- [ ] Create Import Playlist with a clear naming convention (e.g. dated VK import)
- [ ] Add all accepted SoundCloud Tracks (Auto + user-resolved), not likes-as-destination
- [ ] Detect and flag `already_on_sc` while still adding to the playlist
- [ ] Session File stores Import Playlist identity and flags
- [ ] Seam tests assert playlist create/add calls and already_on_sc via fake gateway
- [ ] Rate-limit-friendly pacing for large add batches (basic)
