# 05 — Resolve Ambiguous + Unresolved (listen / pick / search / skip)

**What to build:** The user works an Ambiguous (and Unresolved) queue: see candidates, listen/preview, pick one, search SoundCloud in-app to attach a track, or skip to Unresolved. Decisions update Match Records and the Session File.

**Blocked by:** 04 — Catalog Match pass (Auto / Ambiguous / Unresolved)

**Status:** ready-for-agent

- [ ] Queue UI for Ambiguous Matches with candidate list
- [ ] Listen/preview (SoundCloud preview URL or open-in-SC fallback) for candidates
- [ ] In-app SoundCloud search to bind a SoundCloud Track to a Library Track
- [ ] Skip moves/keeps the track in Unresolved without blocking the queue
- [ ] Session File reflects accepts and skips
- [ ] Seam tests cover pick / search-bind / skip behaviors via fake gateway
