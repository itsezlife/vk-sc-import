# 03 — SoundCloud OAuth PKCE + SoundCloudGateway

**What to build:** The user signs in to SoundCloud in the browser via OAuth 2.1 + PKCE (public client id). The UI shows connected identity; logout clears the session tokens. A SoundCloudGateway port exists with a fake implementation for tests.

**Blocked by:** 01 — SvelteKit + Tailwind shell + friend README

**Status:** ready-for-agent

- [ ] Authorization Code + PKCE against localhost redirect
- [ ] Public client id via env/config; README notes registering a personal app if needed
- [ ] UI connect/disconnect and “connected” empty-state replacement
- [ ] SoundCloudGateway interface + fake gateway for seam tests
- [ ] Tokens stay on the local machine (no hosted SaaS)
