# 02 — Source Library → Import Session + Session File

**What to build:** The user can upload or paste a Source Library (JSON preferred, CSV accepted). Valid Library Tracks create an Import Session persisted to a Session File; invalid rows surface validation errors. Reloading the app can reopen that session’s library state.

**Blocked by:** 01 — SvelteKit + Tailwind shell + friend README

**Status:** ready-for-agent

- [ ] Accept JSON/CSV Source Library with required artist + title per Library Track
- [ ] Reject/report rows missing artist or title without poisoning the session
- [ ] Create Import Session and persist Session File on disk
- [ ] UI shows loaded library count / sample; empty state when none loaded
- [ ] Import Session seam test covers ingest + persistence round-trip (no live SoundCloud)
