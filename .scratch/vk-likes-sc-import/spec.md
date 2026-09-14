Status: ready-for-agent

# Spec: VK likes → SoundCloud Import Playlist (catalog match)

## Problem Statement

I have 1000+ liked tracks on VK Music and want them on SoundCloud as a coherent Import Playlist. Commercial transfer apps (e.g. FreeYourMusic) fail at VK login on my machine, and their Cursor MCP only reuses that same broken desktop session. Re-uploading audio files is the wrong product: I need catalog matching into SoundCloud, with control over doubtful matches, listening to candidates, searching when auto-match fails, and fixing bad links after import without digging through the SoundCloud website by hand. A friend should be able to run the same local tool with a short README.

## Solution

A local SvelteKit + Tailwind app on localhost that:

1. Accepts a Source Library file (JSON/CSV of Library Tracks), produced mainly via a VK Music bookmarklet/DevTools export (manual template as fallback).
2. Connects to SoundCloud via OAuth 2.1 + PKCE (shared public client; README documents registering your own app if needed).
3. Runs Catalog Match with strict Auto-Match; routes the rest to Ambiguous Match or Unresolved.
4. Lets me resolve Ambiguous Matches in the UI: see candidates, listen, pick, or search SoundCloud and attach a track, or skip to Unresolved.
5. Writes accepted matches into one Import Playlist; marks Match Records that were already present on my SoundCloud account.
6. Persists an Import Session in a Session File so I can resume, review confidence, listen to pairs, and Rematch without redoing the whole library.

## User Stories

1. As a VK Music listener, I want to export my likes as a Source Library file, so that the tool does not depend on fragile third-party VK OAuth.
2. As a user, I want a documented bookmarklet/DevTools snippet for VK Music, so that I can dump 1000+ Library Tracks in one sitting.
3. As a user, I want a fallback JSON/CSV template, so that I can still import if the bookmarklet breaks.
4. As a friend of the author, I want a short README (install Node, start app, open browser), so that I can run the tool without reading the code.
5. As a user, I want to sign in to SoundCloud via OAuth in the browser, so that playlist writes happen on my account.
6. As a user, I want PKCE with a public client id, so that I do not commit a client secret to the repo.
7. As a user, I want to paste/upload my Source Library into the local UI, so that an Import Session can start.
8. As a user, I want validation errors if artist/title are missing, so that bad rows do not silently poison matching.
9. As a user, I want matching to be Catalog Match only (no downloads/uploads of audio), so that I stay within a sane legal/ToS posture.
10. As a user, I want strict Auto-Match only when normalized artist+title clearly win over the next candidate, so that false positives are rare.
11. As a user, I want Ambiguous Matches queued for review, so that I decide borderline cases.
12. As a user, I want to see SoundCloud candidates for an Ambiguous Match, so that I can compare options.
13. As a user, I want to preview/listen to candidates in the UI (or via SoundCloud preview/open), so that I can judge by ear.
14. As a user, I want to search SoundCloud from the Ambiguous/Unresolved UI, so that I can attach the right track when auto candidates are wrong or empty.
15. As a user, I want to skip a Library Track, so that it lands in Unresolved instead of blocking the session.
16. As a user, I want an Unresolved list after/during import, so that I can finish leftovers later or accept catalog gaps.
17. As a user, I want all accepted matches added to one Import Playlist, so that my VK likes live as one list on SoundCloud.
18. As a user, I want the Import Playlist named in a clear convention (e.g. dated VK import), so that I can find it later.
19. As a user, I want Match Records flagged `already_on_sc` when the track was already in my SoundCloud library/likes, so that I understand overlap (~30–40% expected).
20. As a user, I still want those tracks in the Import Playlist, so that the playlist is a full mirror of matched VK likes, not only gaps.
21. As a user, I want an Import Session persisted to a Session File, so that closing the browser does not lose review state.
22. As a user, I want to reopen a Session File and continue Ambiguous/Unresolved resolution, so that 1000+ tracks need not finish in one evening.
23. As a user, I want a post-import review of Match Records with confidence level, so that I can audit Auto-Matches.
24. As a user, I want to see which Library Track bound to which SoundCloud Track, so that mismatches are visible.
25. As a user, I want to listen to the bound pair in review, so that I can verify Auto-Matches by ear.
26. As a user, I want Rematch from review (search/pick/listen) to update the Match Record and Import Playlist membership, so that I do not fix mistakes only on soundcloud.com.
27. As a user, I want progress feedback during matching and playlist writes, so that a long run feels controllable.
28. As a user, I want rate-limit friendly pacing toward SoundCloud APIs, so that large libraries do not die mid-run.
29. As a user, I want to cancel or pause a long match run safely with session progress kept, so that I can stop without corrupting state.
30. As a developer, I want a SoundCloudGateway port, so that tests never hit the real network.
31. As a developer, I want Import Session behavior tested at one HTTP/JSON seam, so that matching, resolve, rematch, and persistence are covered as external behavior.
32. As a user, I want clear empty states (no library, not logged in, empty Unresolved), so that the UI explains the next step.
33. As a user, I want the UI to be modern and aesthetic (SvelteKit + Tailwind), so that long review sessions are tolerable.
34. As a user, I do not want React in this project, so that the stack stays SvelteKit.
35. As a user, I want optional later VK auto-fetch behind the same library-file contract, so that automation never becomes the only path.
36. As a friend, I want my own SoundCloud login even if we share a public client id, so that my playlists stay on my account.
37. As a user, I want export of Unresolved (and optionally full Match Records) to a file, so that I can work offline or share gaps.
38. As a user, I want idempotent-ish re-runs against an existing Import Session/playlist strategy documented, so that accidental double-start is recoverable.
39. As a user, I want localhost-only operation (no hosted SaaS), so that tokens and library data stay on my machine.
40. As a user, I want documentation that FreeYourMusic MCP is out of scope, so that agents do not wire that bridge by mistake.

## Implementation Decisions

- **Stack**: SvelteKit + TypeScript + Tailwind; local `npm`/pnpm app; no React; no Flutter; no Electron/Tauri for v1.
- **Primary write target**: one Import Playlist per Import Session (not bulk-liking as the destination).
- **Source contract**: Library file (JSON preferred; CSV accepted) of Library Tracks (`artist`, `title`, optional fields). Bookmarklet/DevTools is the documented producer; unofficial VK Audio API is not the core.
- **Auth**: SoundCloud OAuth 2.1 Authorization Code + PKCE; redirect to localhost; public client id in config/env; README path to register a personal app if required.
- **Matching policy**: strict Auto-Match when normalized artist+title strongly prefer candidate #1 over #2; otherwise Ambiguous or Unresolved.
- **Resolution UX**: Ambiguous → candidates + listen + choose; always allow in-app SoundCloud search; skip → Unresolved.
- **Duplicates**: still add to Import Playlist; set `already_on_sc` on the Match Record when detectable via gateway.
- **Persistence**: Session File on disk (e.g. `session.json` under a known local data dir or project `.data/`); reload restores Match Records and playlist id.
- **Rematch**: updates Match Record and performs playlist remove/add (or equivalent) through SoundCloudGateway.
- **Modules (logical)**:
  - Library ingest/normalize
  - Match scorer/classifier (pure)
  - Import Session service (orchestration + Session File)
  - SoundCloudGateway (OAuth, search, playlist CRUD, library presence, preview URLs)
  - SvelteKit UI routes for connect, upload, resolve, review
- **Test seam**: Import Session HTTP/JSON API (or SvelteKit server endpoints treated as that API) with a fake SoundCloudGateway. Prefer this single seam over UI component tests for core behavior.
- **Optional second pure unit surface**: normalize + score functions may be unit-tested directly as they are deterministic and free of I/O — still not a second product seam for feature acceptance.
- **Playback**: use SoundCloud-provided preview/stream URLs or open-in-SoundCloud fallback; do not scrape VK audio for listening.

## Testing Decisions

- Good tests assert external behavior at the Import Session seam: given a library + fake SC catalog, outputs classifications, session persistence, playlist operations, rematch effects, and Unresolved handling — not Tailwind class names or internal private helpers.
- Modules under test via that seam: session orchestration, classification outcomes, persistence round-trip, rematch playlist mutations (via fake gateway call log).
- Pure normalize/score helpers may have focused unit tests where it reduces fixture noise at the seam.
- Prior art: none in-repo yet (greenfield); establish fixtures as small JSON libraries and fake search result sets.
- Do not require live SoundCloud or VK credentials in CI.

## Out of Scope

- Downloading VK audio or uploading files to SoundCloud.
- FreeYourMusic desktop/MCP integration.
- Unofficial VK token/Kate Mobile API as the required source path.
- Multi-user hosted deployment, accounts, or cloud sync of Session Files.
- Writing primarily to SoundCloud likes instead of an Import Playlist.
- Flutter/React/Electron clients.
- Perfect 100% catalog coverage (Unresolved is expected).
- Importing VK playlists as multiple SC playlists in v1 (source is flat likes; single Import Playlist).

## Further Notes

- Expected overlap: user already has ~30–40% of VK likes on SoundCloud; `already_on_sc` and full playlist membership both matter.
- Commercial tools failed on VK OAuth webview (feed instead of consent) — do not rebuild that auth path for v1.
- Domain vocabulary lives in root `CONTEXT.md`; prefer those terms in tickets and code names.
- Repo path: `/Users/gothiq2302/Documents/VSCodeProjects/nodejs/vk-sc-import` (separate from `chat_scroll_view`).
