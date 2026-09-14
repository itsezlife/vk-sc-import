## Project Configuration

- **Language**: TypeScript
- **Package Manager**: npm
- **Add-ons**: vitest, tailwindcss, prettier, eslint

---

# AGENTS.md

Orientation for agents working in **vk-sc-import**.

Local SvelteKit tool: catalog-match a VK likes library into a SoundCloud import playlist, with interactive match resolution and post-import rematch.

## Agent skills

### Issue tracker

Issues and specs live as local markdown under `.scratch/<feature>/`. See `docs/agents/issue-tracker.md`.

### Triage labels

Canonical roles map 1:1 to `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: root `CONTEXT.md` + `docs/adr/`. See `docs/agents/domain.md`.

### Think / web UI

Before layout, CSS chrome, or components: run the **think** skill and read
[`.cursor/skills/think/web.md`](.cursor/skills/think/web.md) — **viewport**,
**extraction ladder**, **lookalike**, **journey** / **concern cut**,
**orchestration** → ui-kit SoT, page composition. Search existing `ui-*` /
shell classes before inventing.
