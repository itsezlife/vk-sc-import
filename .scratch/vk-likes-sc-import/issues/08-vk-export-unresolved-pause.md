# 08 — VK export bookmarklet/template + Unresolved export + pause/rate-limit

**What to build:** Documented VK likes → Source Library path (bookmarklet/DevTools + JSON template fallback). User can export Unresolved (and optionally full Match Records). Long match/write runs can pause/cancel safely with Session File progress kept; API pacing is documented/hardened for 1000+ tracks.

**Blocked by:** 02 — Source Library → Import Session + Session File; 05 — Resolve Ambiguous + Unresolved; 06 — Import Playlist write + already_on_sc

**Status:** ready-for-agent

- [x] README/docs: bookmarklet or DevTools snippet producing library JSON for VK likes
- [x] Fallback library JSON/CSV template documented
- [x] Export Unresolved list (and optional full Match Records) to a downloadable file
- [x] Pause/cancel match or playlist write without corrupting Session File
- [x] Documented/implemented pacing suitable for 1000+ Catalog Match + playlist adds
- [x] Idempotent-ish re-run / resume behavior described for accidental double-start
