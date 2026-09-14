# 07 — Review Match Records + Rematch

**What to build:** After write, the user reviews Match Records: confidence, Library Track ↔ SoundCloud Track pairs, listen to verify, and Rematch (search/pick) so the Session File and Import Playlist membership update without fixing mistakes only on soundcloud.com.

**Blocked by:** 06 — Import Playlist write + already_on_sc

**Status:** ready-for-agent

- [ ] Review UI lists Match Records with confidence and bound pair
- [ ] Listen/preview for the bound SoundCloud Track (and pair context)
- [ ] Rematch replaces the SoundCloud Track on the Match Record
- [ ] Rematch updates Import Playlist membership through SoundCloudGateway
- [ ] Session File persists rematch outcomes
- [ ] Seam tests cover rematch → gateway remove/add (or equivalent) call log
