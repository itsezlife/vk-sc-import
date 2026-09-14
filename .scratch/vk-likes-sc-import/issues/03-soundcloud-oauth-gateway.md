# 03 — SoundCloud OAuth PKCE + SoundCloudGateway

**What to build:** The user signs in to SoundCloud in the browser via OAuth 2.1 + PKCE (public client id). The UI shows connected identity; logout clears the session tokens. A SoundCloudGateway port exists with a fake implementation for tests.

**Blocked by:** 01 — SvelteKit + Tailwind shell + friend README

**Status:** ready-for-agent

- [x] Authorization Code + PKCE against localhost redirect
- [x] Public client id via env/config; README notes registering a personal app if needed
- [x] UI connect/disconnect and “connected” empty-state replacement
- [x] SoundCloudGateway interface + fake gateway for seam tests
- [x] Tokens stay on the local machine (no hosted SaaS)
