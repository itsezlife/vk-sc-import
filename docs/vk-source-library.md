# Source Library from VK likes

How to turn VK Music likes (or «Моя музыка») into a **Source Library** file this
app can ingest. Catalog Match never talks to VK — only to the file you produce.

## Preferred: DevTools snippet (current VK Music UI)

Works on pages like
`https://vk.ru/audios<YOUR_ID>?section=all` or the Likes section.

1. Sign in to [vk.com](https://vk.com) / [vk.ru](https://vk.ru).
2. Open **Моя музыка** (or Likes) so the track list is visible.
3. DevTools → **Console**, paste the snippet below, press Enter.
4. The script **scrolls the list** until height stabilizes, then builds JSON.
5. JSON is copied when `copy()` exists; paste into the app or save as `.json`.

```js
(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const junk =
    /^(открыть|сниппет|не нравится|показать|похожие|добавить|в мою музыку|меню|ещё|еще|play|add|more|menu|similar|dislike)$/i;

  const normalize = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();

  async function scrollUntilStable() {
    let prev = -1;
    let stable = 0;
    while (stable < 4) {
      const scroller =
        document.querySelector('[class*="AudioList"], [class*="audio_page"], main, #content') ||
        document.scrollingElement ||
        document.body;
      const top = scroller.scrollHeight || document.body.scrollHeight;
      scroller.scrollTo?.(0, top);
      window.scrollTo(0, document.body.scrollHeight);
      await sleep(900);
      const next = document.body.scrollHeight;
      if (next === prev) stable += 1;
      else stable = 0;
      prev = next;
      console.log(`[VK → Source Library] scroll height=${next}`);
    }
  }

  function rows() {
    const sets = [
      '[data-testid="MusicTrackRow"]',
      '[data-testid="audio-item"]',
      '.audio_row',
      '.AudioRow',
      '[data-audio]'
    ];
    for (const sel of sets) {
      const found = [...document.querySelectorAll(sel)];
      if (found.length) return { sel, found };
    }
    return { sel: null, found: [] };
  }

  function fromDataAudio(el) {
    const raw = el.getAttribute('data-audio');
    if (!raw) return null;
    try {
      const data = JSON.parse(raw);
      if (!Array.isArray(data)) return null;
      const title = normalize(data[3]);
      const artist = normalize(data[4]);
      if (artist && title) return { artist, title };
    } catch {
      /* ignore */
    }
    return null;
  }

  function fromModernRow(row) {
    const titleEl = row.querySelector(
      '[data-testid="MusicTrackTitle"], [class*="AudioRow__title"], [class*="audio_row__title"], a[href*="/audio"] span'
    );
    const artistEl = row.querySelector(
      '[data-testid="MusicTrackArtists"], [class*="AudioRow__performers"], [class*="audio_row__performers"], [class*="performer"]'
    );
    let title = normalize(titleEl?.textContent);
    let artist = normalize(artistEl?.textContent);
    if (artist && title) return { artist, title };

    const texts = [...row.querySelectorAll('span, a')]
      .map((n) => normalize(n.textContent))
      .filter((t) => t.length > 0 && !junk.test(t) && !/^\d+$/.test(t) && !t.includes(':'));
    const uniq = [...new Set(texts)];
    if (uniq.length >= 2) {
      // Modern VK often shows title then artist in reading order.
      return { title: uniq[0], artist: uniq[1] };
    }
    return null;
  }

  await scrollUntilStable();

  const { sel, found } = rows();
  console.log(`[VK → Source Library] row selector=${sel ?? 'NONE'}, count=${found.length}`);

  if (!found.length) {
    console.warn(
      '[VK → Source Library] No track rows in DOM. Try Likes/«Моя музыка», wait for the list to paint, or use Network fallback in the docs.'
    );
    return [];
  }

  const seen = new Set();
  const tracks = [];
  for (const row of found) {
    const hit = fromDataAudio(row) || fromModernRow(row);
    if (!hit?.artist || !hit?.title) continue;
    const key = `${hit.artist}\0${hit.title}`.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    tracks.push(hit);
  }

  const json = JSON.stringify(tracks, null, 2);
  if (typeof copy === 'function') copy(json);
  console.log(`[VK → Source Library] ${tracks.length} Library Tracks (JSON copied if copy() exists)`);
  console.log(json);
  return tracks;
})();
```

### If it still returns `0`

Run this **probe** first and paste the log here (or adjust selectors yourself):

```js
(() => {
  const probes = [
    '[data-testid="MusicTrackRow"]',
    '[data-testid="audio-item"]',
    '.audio_row',
    '.AudioRow',
    '[data-audio]',
    '[class*="AudioRow"]',
    '[class*="audio_row"]'
  ];
  for (const sel of probes) {
    console.log(sel, document.querySelectorAll(sel).length);
  }
  const sample = document.querySelector(
    '[data-testid="MusicTrackRow"], [class*="AudioRow"], .audio_row'
  );
  console.log('sample HTML:', sample?.outerHTML?.slice(0, 500));
})();
```

Also check:

- You are on the **track list**, not only playlists/albums chrome.
- The list finished loading (snippet scrolls, but a stuck virtual list may need a manual scroll first).
- Prefer the **Likes** section if `section=all` is a different layout on your account.

## Fallback: Network tab capture

1. Open DevTools → **Network**, filter by `audio` / `load_section` / `al_audio`.
2. Reload the page and scroll the track list.
3. Open JSON/HTML responses that contain track lists; copy `artist` + `title` into  
   `[{ "artist": "…", "title": "…" }, …]`.

Do **not** paste access tokens into this repo or the app.

## Fallback templates

| File | Use |
| ---- | --- |
| [templates/source-library.example.json](templates/source-library.example.json) | Preferred ingest format (array of `{ artist, title }`, or `{ "tracks": [ … ] }`) |
| [templates/source-library.example.csv](templates/source-library.example.csv) | CSV with `artist,title` header |

Invalid rows (empty artist/title) are reported and skipped; they do not wipe an existing Import Session.

## Out of scope

- Unofficial Kate Mobile / token APIs as the **required** path
- FreeYourMusic MCP / desktop bridges
- Downloading VK audio files
