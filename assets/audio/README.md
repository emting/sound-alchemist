# Audio assets

`sfx/` holds 40 MP3 files (30 cards, 10 relics) from
[www.casper.tw/sound-effects](https://www.casper.tw/sound-effects/), with their
50 ms RMS envelopes in `envelopes/` and the index in `manifest.json`.
All 40 measure 128 kbps, stereo, 44.1 kHz. Source, licence terms, the id → sound
table and known timing mismatches are in [CREDITS.md](CREDITS.md).

## Adding or replacing sound effects

1. Put one file per card/relic in `sfx/`, named by id: `sfx/C01.mp3`, `sfx/A01.mp3`, … `sfx/F06.mp3`
   (30 cards) and `sfx/R01.mp3` … `sfx/R10.mp3` (10 relics). The ids are the `id`
   fields of `ALL_CARDS` / `ALL_RELICS` in `sound_alchemist.html`.
   Files must be 128 kbps CBR stereo MP3.
2. Run `node scripts/extract-envelopes.mjs` (needs `ffmpeg` and `ffprobe` on PATH).
   It writes `envelopes/<ID>.json` (50 ms RMS windows) and regenerates `manifest.json`.
3. Commit `sfx/`, `envelopes/` and `manifest.json` together.

Any subset works: ids without a file keep using the synthesizer.

Options: `--allow-nonconforming` keeps files that are not 128 kbps stereo MP3
(default: rejected, exit code 1), `--require-all` fails unless all 40 are present,
`--check` verifies `manifest.json` is up to date without writing,
`--audio-dir <dir>` / `--html <file>` override the paths.

## Runtime

`AudioAssetManager` in `sound_alchemist.html` fetches `manifest.json`, then each
listed MP3 and envelope. Assets only load when the page is served over HTTP(S);
when opened from `file://`, offline, or when a fetch/decode fails, that id falls
back to the synthesizer.

- Instant (0 s) cards and relics: the MP3 replaces the synth chime and plays from its start.
- Charged cards: the charge sound is always the synthesizer. The MP3 is the hit and starts
  when the cast is released (`playCardHit`), not at a scheduled time. It plays only on a
  peak release, where it replaces the synth chime. An off-peak release plays only the
  synth miss tone, and an overload misfire (never released) plays no MP3.
- A hit starts at the clip's attack: the first 50 ms window that reaches half of the
  loudest window's RMS (`attackTime`, derived from the envelope). This skips a silent or
  quiet lead-in so the hit is not late; anything before that point is never heard.

## Envelope format

```json
{ "id": "C02", "file": "sfx/C02.mp3", "windowMs": 50, "sampleRate": 44100,
  "channels": 2, "bitrate": 128000, "duration": 1.0, "peakIndex": 14,
  "peakTime": 0.725, "peakRms": 0.56568, "rms": [0.07071, "…"] }
```

`rms` is linear RMS (0–1) per consecutive 50 ms window, both channels pooled.
