# sound-alchemist
Sound Alchemist v3.0 — audio-synced roguelike tower defense web game

## Rebuild Tailwind CSS

Run `npm ci` once from the repository root, then run `npm run build:css` after
editing utility classes in `sound_alchemist.html`. Commit the generated
`assets/css/tailwind.css` so GitHub Pages and direct HTML opens use the same CSS.
Keep complete class names in JavaScript strings or add computed classes to
`tailwind.config.cjs`'s safelist.

## Rebuild the Traditional Chinese font subset

Install the font build dependencies with `python -m pip install fonttools==4.65.0 Brotli==1.2.1`.
After adding game text, run `python scripts/build-font.py` and commit the updated
`assets/fonts/noto-sans-tc.woff2`. The script keeps glyphs used by the HTML and
inline JavaScript, including Canvas labels. The source and font license are
pinned to the same Google Fonts revision.
