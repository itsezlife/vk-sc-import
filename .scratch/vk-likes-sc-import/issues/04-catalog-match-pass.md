# 04 — Catalog Match pass (Auto / Ambiguous / Unresolved)

**What to build:** From a loaded Import Session and connected SoundCloud, the user runs Catalog Match. Each Library Track becomes a Match Record classified as Auto-Match, Ambiguous Match, or Unresolved under the strict auto policy. Progress is visible; results persist in the Session File.

**Blocked by:** 02 — Source Library → Import Session + Session File; 03 — SoundCloud OAuth PKCE + SoundCloudGateway

**Status:** ready-for-agent

- [ ] Search via SoundCloudGateway and score/classify with strict Auto-Match rules
- [ ] Match Records land in Auto / Ambiguous / Unresolved buckets
- [ ] Progress feedback during a long match run
- [ ] Session File updated with Match Records after the pass
- [ ] Seam tests with fake catalog cover classification outcomes (external behavior)
- [ ] Optional unit tests for pure normalize/score only where they reduce seam fixture noise
