# Sound effect credits

Sound effects: [www.casper.tw/sound-effects](https://www.casper.tw/sound-effects/)

The 40 MP3 files in `sfx/` were downloaded unmodified from casper.tw, one per card / relic.
Licence: <https://www.casper.tw/sound-effects/license/> (read 2026-11-22). In summary, that page says:

- The sounds may be used in work that earns money, including paid apps and games.
- Credit is not required, but a line such as "Sound effects: www.casper.tw/sound-effects" is appreciated.
- Do not repackage them as a sound pack or a library of your own.
- Do not use them, on their own or as part of a dataset, to train or fine-tune a generative AI model.
- The sounds were generated with Stable Audio; the page carries the Stability AI Community License notice.

These files are shipped here only as part of the game. The licence page is authoritative; re-read it before reusing the files elsewhere.

## Mapping

Bitrate and channels are from `ffprobe`; length and peak (loudest 50 ms RMS window) are from the decoded audio.
The file name on casper.tw is `https://sound-effects.casper.tw/audio/<file>.mp3`; the link goes to the group on the category page.

| id | Card / relic | casper.tw sound | File (source page) | Bitrate | Ch | Length s | Peak at s | Charge s | Notes |
|---|---|---|---|---|---|---|---|---|---|
| C01 | 奧術音彈 | 魔法飛彈咻聲 | [`magic-missile-zip.08c9977a`](https://www.casper.tw/sound-effects/zh-tw/game/#sfx-group-magic-spell) | 320 kbps | 2 | 2.47 | 0.38 | 0.0 | ok |
| C02 | 鐵壁共鳴盾 | 金屬格擋聲 | [`fantasy-block-metal.d8dc7bc5`](https://www.casper.tw/sound-effects/zh-tw/game/#sfx-group-shield-block) | 320 kbps | 2 | 1.84 | 0.03 | 0.8 | Timing: silent for the first 0.63 s of the 0.8 s charge (clip peaks 0.03 s after its start). |
| C03 | 雙發脈衝 | 復古雷射槍雙發聲 | [`retro-ray-gun-pew.27ad8780`](https://www.casper.tw/sound-effects/zh-tw/game/#sfx-group-laser) | 320 kbps | 2 | 1.54 | 0.12 | 0.6 | ok |
| C04 | 韻律重洗 | 嘩啦洗牌聲 | [`card-shuffle-riffle.7cc72079`](https://www.casper.tw/sound-effects/zh-tw/game/#sfx-group-playing-cards) | 320 kbps | 2 | 3.18 | 0.53 | 0.5 | Timing: audible ~2.2 s after the card resolves. |
| A01 | 瞬光打擊 | 閃光魔法 | [`fantasy-spell-flash.4418a74f`](https://www.casper.tw/sound-effects/zh-tw/game/#sfx-group-magic-spell) | 320 kbps | 2 | 0.25 | 0.03 | 0.0 | ok |
| A02 | 掃頻橫斬 | 掃頻魔法 | [`fantasy-spell-sweep.c1e5f2e8`](https://www.casper.tw/sound-effects/zh-tw/game/#sfx-group-magic-spell) | 320 kbps | 2 | 3.97 | 1.27 | 1.4 | Timing: audible ~2.3 s after the card resolves. |
| A03 | 虛空漩渦 | 漩渦魔法 | [`fantasy-spell-vortex.4403298c`](https://www.casper.tw/sound-effects/zh-tw/game/#sfx-group-magic-spell) | 320 kbps | 2 | 3.66 | 1.48 | 1.2 | Timing: clip starts 0.50 s in (its peak is at 1.48 s, card peak at 0.98 s); audible ~1.7 s after the card resolves. |
| A04 | 爆裂火球 | 火球命中爆裂聲 | [`fireball-hit-burst-fiery-roar.f25f2bc7`](https://www.casper.tw/sound-effects/zh-tw/game/#sfx-group-fire-spell) | 320 kbps | 2 | 3.26 | 0.78 | 1.8 | Timing: silent for the first 0.70 s of the 1.8 s charge (clip peaks 0.78 s after its start). |
| A05 | 霜晶封鎖 | 冰晶凍結劈啪聲 | [`ice-spell-crackle.8933b51a`](https://www.casper.tw/sound-effects/zh-tw/game/#sfx-group-ice-spell) | 320 kbps | 2 | 3.16 | 0.28 | 1.3 | Timing: silent for the first 0.79 s of the 1.3 s charge (clip peaks 0.28 s after its start); audible ~1.5 s after the card resolves. |
| A06 | 天雷劈擊 | 雷系魔法劈擊聲 | [`lightning-bolt-crack.42b0ea77`](https://www.casper.tw/sound-effects/zh-tw/game/#sfx-group-lightning-spell) | 320 kbps | 2 | 2.91 | 1.73 | 2.1 | ok |
| A07 | 聖光湧泉 | 聖光轟擊 | [`holy-light-strike-shimmer-chime.082dafb3`](https://www.casper.tw/sound-effects/zh-tw/game/#sfx-group-magic-spell) | 320 kbps | 2 | 3.14 | 0.28 | 1.5 | Card names two sounds (聖光轟擊 + 療癒微風); one file per id, so only 聖光轟擊 is used. Timing: silent for the first 0.95 s of the 1.5 s charge (clip peaks 0.28 s after its start). |
| S01 | 反應爐超載 | 反應爐充能 | [`energy-reactor-spool.256f985d`](https://www.casper.tw/sound-effects/zh-tw/game/#sfx-group-power-charge) | 320 kbps | 2 | 3.89 | 3.33 | 1.6 | Timing: clip starts 2.02 s in (its peak is at 3.33 s, card peak at 1.31 s). |
| S02 | 電漿步槍 | 電漿步槍射擊聲 | [`plasma-rifle-shot.fa245e65`](https://www.casper.tw/sound-effects/zh-tw/game/#sfx-group-laser) | 320 kbps | 2 | 2.84 | 0.33 | 0.9 | ok |
| S03 | 持續雷射束 | 持續雷射光束嗡鳴 | [`laser-beam-continuous-buzzing-hum.53054673`](https://www.casper.tw/sound-effects/zh-tw/game/#sfx-group-laser) | 320 kbps | 2 | 4.00 | 1.82 | 2.4 | Timing: audible ~1.7 s after the card resolves. |
| S04 | 冷凍射線 | 冷凍光線射擊聲 | [`freeze-ray-crystalline-sweep.a25473b0`](https://www.casper.tw/sound-effects/zh-tw/game/#sfx-group-energy-weapons) | 320 kbps | 2 | 3.08 | 0.38 | 1.1 | Timing: silent for the first 0.52 s of the 1.1 s charge (clip peaks 0.38 s after its start). |
| S05 | 離子砲齊射 | 離子砲轟擊聲 | [`ion-cannon-charge-deep-boom.151a5fe1`](https://www.casper.tw/sound-effects/zh-tw/game/#sfx-group-energy-weapons) | 320 kbps | 2 | 3.37 | 0.03 | 2.2 | Timing: silent for the first 1.77 s of the 2.2 s charge (clip peaks 0.03 s after its start); audible ~2.4 s after the card resolves. |
| S06 | 電磁軌道砲 | 電磁砲射擊聲 | [`railgun-electric-crack-thud-ring.f2fa632e`](https://www.casper.tw/sound-effects/zh-tw/game/#sfx-group-energy-weapons) | 320 kbps | 2 | 3.09 | 0.17 | 3.0 | Timing: silent for the first 2.29 s of the 3.0 s charge (clip peaks 0.17 s after its start). |
| S07 | 曲速力場 | 曲速力場 | [`ship-warp-field.7b83e167`](https://www.casper.tw/sound-effects/zh-tw/game/#sfx-group-spaceship) | 320 kbps | 2 | 3.08 | 2.27 | 2.5 | No sound named 曲速躍遷蓄力; nearest by name in 太空船 is 曲速力場. |
| M01 | 古箏疾奏 | 古箏刮奏 | [`guzheng-glissando-sweep.31ff0ff2`](https://www.casper.tw/sound-effects/zh-tw/game/#sfx-group-east-asian-strings) | 320 kbps | 2 | 3.57 | 0.62 | 0.7 | ok |
| M02 | 琵琶輪指 | 琵琶輪指 | [`pipa-tremolo-strum.6a434c71`](https://www.casper.tw/sound-effects/zh-tw/game/#sfx-group-east-asian-strings) | 320 kbps | 2 | 3.14 | 0.62 | 0.8 | Timing: audible ~2.0 s after the card resolves. |
| M03 | 空靈簫音 | 空靈簫聲 | [`xiao-end-blown-hollow-breathy-note.989218c6`](https://www.casper.tw/sound-effects/zh-tw/game/#sfx-group-flute) | 320 kbps | 2 | 4.00 | 1.07 | 1.2 | Timing: audible ~2.4 s after the card resolves. |
| M04 | 豎琴祝禱 | 豎琴上行刮奏 | [`harp-glissando-sweep.e0d29d0c`](https://www.casper.tw/sound-effects/zh-tw/game/#sfx-group-plucked-string) | 320 kbps | 2 | 3.44 | 0.68 | 1.0 | Card names two sounds (豎琴上行刮奏 + 豎琴治療); only 豎琴上行刮奏 is used. |
| M05 | 大鍵琴滑階 | 大鍵琴上行音階 | [`harpsichord-quick-ascending-run.b94c92e5`](https://www.casper.tw/sound-effects/zh-tw/game/#sfx-group-plucked-string) | 320 kbps | 2 | 3.10 | 0.17 | 0.5 | ok |
| M06 | 百鳥笙和鳴 | 笙和弦 | [`sheng-bright-reedy-swell-chord.c209ec51`](https://www.casper.tw/sound-effects/zh-tw/game/#sfx-group-world-instruments) | 320 kbps | 2 | 3.80 | 1.52 | 1.8 | ok |
| F01 | 微塵毒針 | 迷你噗聲 | [`react-fart-tinypuff.88ec54b0`](https://www.casper.tw/sound-effects/zh-tw/fart/#react-fart-tinypuff) | 320 kbps | 2 | 0.25 | 0.03 | 0.25 | Matched by English slug (tinypuff) and 0.25 s length; site's zh-tw name differs. |
| F02 | 尖響干擾波 | 短促高音 | [`react-fart-shortsqueak.1557d03b`](https://www.casper.tw/sound-effects/zh-tw/fart/#react-fart-shortsqueak) | 320 kbps | 2 | 0.30 | 0.03 | 0.3 | Matched by English slug (shortsqueak) and 0.30 s length; site's zh-tw name differs. |
| F03 | 濕黏酸蝕 | 濕潤噗滋聲 | [`react-fart-wetsplutter.e9a33fd1`](https://www.casper.tw/sound-effects/zh-tw/fart/#react-fart-wetsplutter) | 320 kbps | 2 | 0.60 | 0.03 | 0.6 | Matched by English slug (wetsplutter) and 0.60 s length; site's zh-tw name differs. |
| F04 | 綿長沼氣陣 | 悠長低鳴 | [`react-fart-longrumble.f9a23535`](https://www.casper.tw/sound-effects/zh-tw/fart/#react-fart-longrumble) | 320 kbps | 2 | 3.14 | 1.23 | 3.15 | Matched by English slug (longrumble) and ~3.15 s length; site's zh-tw name differs. Timing: silent for the first 1.35 s of the 3.15 s charge (clip peaks 1.23 s after its start). |
| F05 | 悲傷長號詛咒 | 悲傷長號 | [`react-sadtrombone-single.96c5638e`](https://www.casper.tw/sound-effects/zh-tw/reactions/#sfx-group-sad-trombone) | 320 kbps | 2 | 3.43 | 1.38 | 2.95 | Name matches, but no 2.95 s variant exists; chosen variant is 3.43 s. Timing: silent for the first 1.04 s of the 2.95 s charge (clip peaks 1.38 s after its start). |
| F06 | 橡皮雞嘲諷 | 橡皮雞吱叫聲 | [`squeaky-rubber-chicken.84123b21`](https://www.casper.tw/sound-effects/zh-tw/reactions/#sfx-group-squeaky-toy) | 320 kbps | 2 | 3.28 | 0.07 | 0.4 | Timing: audible ~3.1 s after the card resolves. |
| R01 | 黃金調音叉 | 成就解鎖叮聲 | [`achievement-unlock-ding.465afb07`](https://www.casper.tw/sound-effects/zh-tw/game/#sfx-group-level-complete) | 320 kbps | 2 | 2.34 | 0.28 | – | ok |
| R02 | 雙聲道懷錶 | 子彈時間降調聲 | [`bullet-time-pitch-drop-stretched-thud.6353b40f`](https://www.casper.tw/sound-effects/zh-tw/game/#sfx-group-time-warp) | 320 kbps | 2 | 2.41 | 0.07 | – | ok |
| R03 | 柏青哥彈珠袋 | 鋼珠連續發射聲 | [`pachinko-ball-launch-spring.d89356d3`](https://www.casper.tw/sound-effects/zh-tw/game/#sfx-group-pachinko) | 320 kbps | 2 | 3.25 | 0.38 | – | Timing: audible for ~2.5 s on an instant trigger. |
| R04 | 神社雙拍木 | 神社雙拍手聲 | [`shrine-clap-pair.d1815e39`](https://www.casper.tw/sound-effects/zh-tw/reactions/#shrine-clap-pair) | 320 kbps | 2 | 3.32 | 1.93 | – | Timing: audible for ~3.2 s on an instant trigger. |
| R05 | 幸運轉蛋殼 | 轉蛋旋鈕與掉落聲 | [`capsule-toy-crank.b0163270`](https://www.casper.tw/sound-effects/zh-tw/game/#capsule-toy-crank) | 320 kbps | 2 | 2.89 | 0.12 | – | Timing: audible for ~2.8 s on an instant trigger. |
| R06 | 存檔點火種 | 存檔點火焰與鈴聲 | [`checkpoint-flame-whoosh-soft-bell.b3002ae3`](https://www.casper.tw/sound-effects/zh-tw/game/#checkpoint-flame-whoosh-soft-bell) | 320 kbps | 2 | 2.87 | 0.17 | – | ok |
| R07 | 溢滿存錢筒 | 金幣堆傾倒滑落聲 | [`loot-pile-of-coins-spill-settle.df62411d`](https://www.casper.tw/sound-effects/zh-tw/game/#sfx-group-coin) | 320 kbps | 2 | 2.99 | 1.98 | – | No sound named 金幣傾瀉叮噹聲; nearest in 金幣 is 金幣堆傾倒滑落聲. Timing: audible for ~2.5 s on an instant trigger. |
| R08 | 次元靜電球 | 靜電場 | [`magic-volt-field.e6071baa`](https://www.casper.tw/sound-effects/zh-tw/game/#sfx-group-lightning-spell) | 320 kbps | 2 | 3.09 | 2.98 | – | Timing: audible for ~3.0 s on an instant trigger. |
| R09 | 綜藝打地鼠槌 | 打地鼠木槌聲 | [`mallet-mole-bonk.acba2e04`](https://www.casper.tw/sound-effects/zh-tw/game/#sfx-group-bonk) | 320 kbps | 2 | 0.32 | 0.07 | – | ok |
| R10 | 頻譜煉金爐 | 獎盃鐘響 | [`fanfare-trophy-bell.a08bd811`](https://www.casper.tw/sound-effects/zh-tw/game/#sfx-group-level-complete) | 320 kbps | 2 | 1.59 | 0.03 | – | ok |
