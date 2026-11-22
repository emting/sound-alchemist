// Run: node --test scripts/
// Generates its own throwaway MP3s with ffmpeg (synthetic tones, nothing is committed).
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, test } from 'node:test';
import { buildAll, readAssetIds, rmsEnvelope } from './extract-envelopes.mjs';

const htmlPath = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'sound_alchemist.html');
let dir;

// 0.6 s at amplitude 0.1, then 0.2 s at 0.8, then 0.2 s at 0.1 (440 Hz sine).
function makeTone(file, extra) {
  const expr = "sin(2*PI*440*t)*if(between(t\\,0.6\\,0.8)\\,0.8\\,0.1)";
  const res = spawnSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', `aevalsrc=${expr}|${expr}:s=44100:d=1`, ...extra, file]);
  assert.equal(res.status, 0, String(res.stderr));
}

before(() => {
  dir = mkdtempSync(join(tmpdir(), 'sa-env-'));
  mkdirSync(join(dir, 'sfx'));
  makeTone(join(dir, 'sfx', 'C01.mp3'), ['-c:a', 'libmp3lame', '-b:a', '320k', '-ac', '2']);
  makeTone(join(dir, 'sfx', 'C02.mp3'), ['-c:a', 'libmp3lame', '-b:a', '128k', '-ac', '2']);
  makeTone(join(dir, 'sfx', 'R01.mp3'), ['-c:a', 'libmp3lame', '-b:a', '320k', '-ac', '1']);
});
after(() => rmSync(dir, { recursive: true, force: true }));

test('game data declares 30 cards and 10 relics with unique ids', () => {
  const { cards, relics } = readAssetIds(htmlPath);
  assert.equal(cards.length, 30);
  assert.equal(relics.length, 10);
  assert.equal(new Set([...cards, ...relics]).size, 40);
});

test('rmsEnvelope pools channels over 50 ms windows', () => {
  const sr = 1000;
  const pcm = new Float32Array(sr * 2 * 0.125); // 125 ms stereo
  pcm.fill(0.5, 0, 100); // first 50 ms, both channels
  const rms = rmsEnvelope(pcm, sr, 2);
  assert.equal(rms.length, 3);
  assert.ok(Math.abs(rms[0] - 0.5) < 1e-6);
  assert.equal(rms[1], 0);
});

test('320 kbps stereo MP3 yields a 50 ms RMS envelope with the right peak', () => {
  const { manifest, rejected } = buildAll({ audioDir: dir, htmlPath, log: () => {} });
  assert.deepEqual(Object.keys(manifest.assets), ['C01']);
  const env = JSON.parse(readFileSync(join(dir, 'envelopes', 'C01.json'), 'utf8'));
  assert.equal(env.windowMs, 50);
  assert.equal(env.channels, 2);
  assert.equal(env.rms.length, Math.ceil(env.duration / 0.05));
  assert.ok(env.peakTime > 0.6 && env.peakTime < 0.8, `peakTime ${env.peakTime}`);
  assert.ok(Math.abs(env.peakRms - 0.8 / Math.SQRT2) < 0.03, `peakRms ${env.peakRms}`);
  assert.ok(Math.abs(env.rms[4] - 0.1 / Math.SQRT2) < 0.01, `quiet rms ${env.rms[4]}`);
  assert.equal(manifest.assets.C01.peakTime, env.peakTime);

  // 128 kbps and mono files are refused and stay on the synth fallback.
  assert.deepEqual(rejected.map((r) => r.id).sort(), ['C02', 'R01']);
  assert.ok(manifest.missing.includes('C02') && manifest.missing.includes('R01'));
  assert.equal(manifest.missing.length, 39);
});

test('--allow-nonconforming keeps off-spec files', () => {
  const { manifest, rejected } = buildAll({ audioDir: dir, htmlPath, allowNonconforming: true, log: () => {} });
  assert.equal(rejected.length, 0);
  assert.deepEqual(Object.keys(manifest.assets).sort(), ['C01', 'C02', 'R01']);
});
