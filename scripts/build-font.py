"""Build the game's Traditional Chinese WOFF2 from a pinned Google Fonts source."""

from html import unescape
from io import BytesIO
from pathlib import Path
from urllib.request import urlopen

from fontTools import subset
from fontTools.ttLib import TTFont


ROOT = Path(__file__).resolve().parents[1]
SOURCE = (
    "https://raw.githubusercontent.com/google/fonts/"
    "83c62e30d87daa70216dab6b984d00d20d96d585/"
    "ofl/notosanstc/NotoSansTC%5Bwght%5D.ttf"
)

with urlopen(SOURCE, timeout=60) as response:
    font = TTFont(BytesIO(response.read()), recalcTimestamp=False)

# DOM labels, card data, and Canvas strings all live in this file. Retain
# printable ASCII as well for interpolated numbers and Canvas labels.
game = (ROOT / "sound_alchemist.html").read_text(encoding="utf-8")
characters = set(unescape(game)) | {chr(codepoint) for codepoint in range(32, 127)}
options = subset.Options()
subsetter = subset.Subsetter(options=options)
subsetter.populate(text="".join(sorted(characters)))
subsetter.subset(font)

font.flavor = "woff2"
font.save(ROOT / "assets/fonts/noto-sans-tc.woff2")
