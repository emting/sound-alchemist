# Audio assets

**No MP3 files are committed here.** `manifest.json` currently lists all 40 ids as
`missing`, so the game plays the procedural Web Audio synthesizer for every card
and relic. The pipeline and loader are in place; the audio itself still has to
be supplied by someone who holds a licence to redistribute it.

## Adding real sound effects

1. Put one file per card/relic in `sfx/`, named by id: `sfx/C01.mp3`, `sfx/A01.mp3`, … `sfx/F06.mp3`
   (30 cards) and `sfx/R01.mp3` … `sfx/R10.mp3` (10 relics). The ids are the `id`
   fields of `ALL_CARDS` / `ALL_RELICS` in `sound_alchemist.html`.
   Files must be 320 kbps stereo MP3.
2. Run `node scripts/extract-envelopes.mjs` (needs `ffmpeg` and `ffprobe` on PATH).
   It writes `envelopes/<ID>.json` (50 ms RMS windows) and regenerates `manifest.json`.
3. Commit `sfx/`, `envelopes/` and `manifest.json` together.

Any subset works: ids without a file keep using the synthesizer.

Options: `--allow-nonconforming` keeps files that are not 320 kbps stereo MP3
(default: rejected, exit code 1), `--require-all` fails unless all 40 are present,
`--check` verifies `manifest.json` is up to date without writing,
`--audio-dir <dir>` / `--html <file>` override the paths.

## Runtime

`AudioAssetManager` in `sound_alchemist.html` fetches `manifest.json`, then each
listed MP3 and envelope. Assets only load when the page is served over HTTP(S);
when opened from `file://`, offline, or when a fetch/decode fails, that id falls
back to the synthesizer. For charged cards the clip is shifted so that its loudest
50 ms window (`peakTime`) lands on the card's peak moment (82% of the charge time).

## Envelope format

```json
{ "id": "C02", "file": "sfx/C02.mp3", "windowMs": 50, "sampleRate": 44100,
  "channels": 2, "bitrate": 320000, "duration": 1.0, "peakIndex": 14,
  "peakTime": 0.725, "peakRms": 0.56568, "rms": [0.07071, "…"] }
```

`rms` is linear RMS (0–1) per consecutive 50 ms window, both channels pooled.
