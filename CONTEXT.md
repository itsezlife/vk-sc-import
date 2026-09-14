# VK → SoundCloud Catalog Import

Local tool that catalog-matches a Source Library of VK likes into a SoundCloud Import Playlist, with interactive Match Resolution and post-import Rematch.

## Language

### Libraries and tracks

**Source Library**:
The flat list of tracks the user wants to import, typically VK likes expressed as artist + title rows in a library file.
_Avoid_: VK dump, playlist export, music collection (when meaning this input)

**Library Track**:
One row in the Source Library: at minimum artist and title (optional ids/metadata).
_Avoid_: Song, audio, VK audio object

**SoundCloud Track**:
A track identity in the SoundCloud catalog that can be added to a playlist.
_Avoid_: SC song, stream, upload

**Import Playlist**:
The SoundCloud playlist that receives matched tracks for one Import Session.
_Avoid_: Likes folder, destination library, liked songs (as the write target)

### Matching

**Catalog Match**:
Finding a SoundCloud Track for a Library Track by search and scoring — not by copying audio files.
_Avoid_: Transfer, download, re-upload, sync (when meaning file copy)

**Auto-Match**:
A Catalog Match accepted without user review because confidence is strictly high.
_Avoid_: Blind match, forced match

**Ambiguous Match**:
A Catalog Match with candidates that need user choice (listen / pick / search).
_Avoid_: Fuzzy match, conflict, collision

**Unresolved**:
A Library Track left without an accepted SoundCloud Track (skip or no catalog hit).
_Avoid_: Failed, error, missing (as the bucket name)

**Match Record**:
The binding of one Library Track to zero or one SoundCloud Track, plus confidence and flags such as already-on-SC.
_Avoid_: Result row, mapping, link

**Rematch**:
Replacing the SoundCloud Track on an existing Match Record and updating the Import Playlist accordingly.
_Avoid_: Edit, fixup, reassign (when meaning this flow)

### Session

**Import Session**:
One durable run: Source Library in, Match Records and Import Playlist out, persisted so review can continue later.
_Avoid_: Job, batch, transfer run

**Session File**:
The on-disk persistence of an Import Session (e.g. session.json).
_Avoid_: Database, cache, savegame
