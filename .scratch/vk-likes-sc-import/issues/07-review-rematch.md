# 07 — Review Match Records + Rematch

**What to build:** After write, the user reviews Match Records: confidence, Library Track ↔ SoundCloud Track pairs, listen to verify, and Rematch (search/pick) so the Session File and Import Playlist membership update without fixing mistakes only on soundcloud.com.

**Blocked by:** 06 — Import Playlist write + already_on_sc

**Status:** ready-for-human

- [x] Review UI lists Match Records with confidence and bound pair
- [x] Listen/preview for the bound SoundCloud Track (and pair context)
- [x] Rematch replaces the SoundCloud Track on the Match Record
- [x] Rematch updates Import Playlist membership through SoundCloudGateway
- [x] Session File persists rematch outcomes
- [x] Seam tests cover rematch → gateway remove/add (or equivalent) call log

## Comments

- Implemented: `getReviewList` + `rematch` on Import Session API; `rematchBoundTrack` / `buildReviewList` / `boundPlaylistTrackIds`; `GET /api/session/review`, `POST /api/session/review/rematch`; `ReviewRematchPanel` journey (listen + search Rematch). Seam: `review-rematch.seam.spec.ts` (fake gateway `setPlaylistTracks` + Session File).
