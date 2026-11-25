#!/usr/bin/env node
// Offline envelope pipeline for Sound Alchemist.
//
// Reads assets/audio/sfx/<ID>.mp3 for the 30 cards + 10 relics declared in
// sound_alchemist.html, checks each file is a 128 kbps stereo MP3, and writes
//   assets/audio/envelopes/<ID>.json  (50 ms RMS envelope)
//   assets/audio/manifest.json        (what the runtime AudioAssetManager loads)
//
// Requires ffmpeg + ffprobe on PATH. No npm dependencies.
//
// Usage: node scripts/extract-envelopes.mjs [--audio-dir <dir>] [--html <file>]
//          [--allow-nonconforming] [--require-all] [--check]

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const WINDOW_MS = 50;
export const REQUIRED = { codec: 'mp3', channels: 2, bitrate: 128000 };
const BITRATE_TOLERANCE = 0.02;

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// Card/relic IDs come from the game data so the two cannot drift apart.
export function readAssetIds(htmlPath) {
  const html = readFileSync(htmlPath, 'utf8');
  const block = (name) => {
    const start = html.indexOf(`const ${name} = [`);
    if (start < 0) throw new Error(`${name} not found in ${htmlPath}`);
    const end = html.indexOf('\n    ];', start);
    return [...html.slice(start, end).matchAll(/\bid:\s*'([A-Z]\d{2})'/g)].map((m) => m[1]);
  };
  return { cards: block('ALL_CARDS'), relics: block('ALL_RELICS') };
}

function run(cmd, args, opts = {}) {
  const res = spawnSync(cmd, args, { maxBuffer: 1 << 30, ...opts });
  if (res.error) {
    if (res.error.code === 'ENOENT') throw new Error(`${cmd} not found on PATH (install ffmpeg)`);
    throw res.error;
  }
  if (res.status !== 0) throw new Error(`${cmd} failed: ${String(res.stderr).trim().split('\n').pop()}`);
  return res.stdout;
}

export function probe(file) {
  const out = run('ffprobe', [
    '-v', 'error', '-select_streams', 'a:0',
    '-show_entries', 'stream=codec_name,channels,sample_rate,bit_rate:format=duration',
    '-of', 'json', file,
  ]);
  const info = JSON.parse(out.toString('utf8'));
  const s = (info.streams || [])[0];
  if (!s) throw new Error('no audio stream');
  return {
    codec: s.codec_name,
    channels: Number(s.channels),
    sampleRate: Number(s.sample_rate),
    bitrate: Number(s.bit_rate),
    duration: Number(info.format && info.format.duration),
  };
}

export function conformanceProblems(info) {
  const problems = [];
  if (info.codec !== REQUIRED.codec) problems.push(`codec is ${info.codec}, expected mp3`);
  if (info.channels !== REQUIRED.channels) problems.push(`${info.channels} channel(s), expected stereo`);
  if (!(Math.abs(info.bitrate - REQUIRED.bitrate) <= REQUIRED.bitrate * BITRATE_TOLERANCE)) {
    problems.push(`bitrate is ${Math.round(info.bitrate / 1000)} kbps, expected 128 kbps`);
  }
  return problems;
}

// Interleaved float32 PCM at the file's own sample rate and channel count.
export function decodePcm(file) {
  const buf = run('ffmpeg', ['-v', 'error', '-i', file, '-map', 'a:0', '-f', 'f32le', '-c:a', 'pcm_f32le', '-']);
  return new Float32Array(buf.buffer, buf.byteOffset, Math.floor(buf.byteLength / 4));
}

// RMS over consecutive 50 ms windows, all channels pooled. The last window may be short.
export function rmsEnvelope(pcm, sampleRate, channels, windowMs = WINDOW_MS) {
  const frames = Math.floor(pcm.length / channels);
  const windowFrames = Math.max(1, Math.round((sampleRate * windowMs) / 1000));
  const rms = [];
  for (let start = 0; start < frames; start += windowFrames) {
    const end = Math.min(frames, start + windowFrames);
    let sum = 0;
    for (let i = start * channels; i < end * channels; i++) sum += pcm[i] * pcm[i];
    rms.push(Math.sqrt(sum / ((end - start) * channels)));
  }
  return rms;
}

export function buildEnvelope(id, file, info, pcm) {
  const rms = rmsEnvelope(pcm, info.sampleRate, info.channels);
  let peakIndex = 0;
  for (let i = 1; i < rms.length; i++) if (rms[i] > rms[peakIndex]) peakIndex = i;
  const duration = pcm.length / info.channels / info.sampleRate;
  const round = (v, d) => Number(v.toFixed(d));
  return {
    id,
    file,
    windowMs: WINDOW_MS,
    sampleRate: info.sampleRate,
    channels: info.channels,
    bitrate: info.bitrate,
    duration: round(duration, 4),
    peakIndex,
    // Centre of the loudest window, clamped to the clip length.
    peakTime: round(Math.min(duration, ((peakIndex + 0.5) * WINDOW_MS) / 1000), 4),
    peakRms: round(rms[peakIndex] || 0, 5),
    rms: rms.map((v) => round(v, 5)),
  };
}

export function buildAll({ audioDir, htmlPath, allowNonconforming = false, write = true, log = console.log }) {
  const { cards, relics } = readAssetIds(htmlPath);
  const ids = [...cards, ...relics];
  const sfxDir = join(audioDir, 'sfx');
  const envDir = join(audioDir, 'envelopes');
  const manifest = { version: 1, windowMs: WINDOW_MS, expected: { cards: cards.length, relics: relics.length }, assets: {}, missing: [] };
  const rejected = [];

  if (write) {
    mkdirSync(envDir, { recursive: true });
    for (const f of readdirSync(envDir)) if (f.endsWith('.json')) rmSync(join(envDir, f));
  }

  for (const id of ids) {
    const rel = `sfx/${id}.mp3`;
    const file = join(audioDir, rel);
    if (!existsSync(file)) {
      manifest.missing.push(id);
      continue;
    }
    try {
      const info = probe(file);
      const problems = conformanceProblems(info);
      if (problems.length && !allowNonconforming) throw new Error(problems.join('; '));
      if (problems.length) log(`WARN ${id}: ${problems.join('; ')} (kept: --allow-nonconforming)`);
      const env = buildEnvelope(id, rel, info, decodePcm(file));
      if (!env.rms.length || env.peakRms <= 0) throw new Error('decoded audio is empty or silent');
      if (write) writeFileSync(join(envDir, `${id}.json`), JSON.stringify(env) + '\n');
      manifest.assets[id] = { file: rel, envelope: `envelopes/${id}.json`, duration: env.duration, peakTime: env.peakTime };
      log(`ok   ${id}: ${env.duration.toFixed(2)}s, ${env.rms.length} windows, peak @ ${env.peakTime.toFixed(3)}s`);
    } catch (err) {
      rejected.push({ id, reason: err.message });
      manifest.missing.push(id);
      log(`FAIL ${id}: ${err.message}`);
    }
  }

  const known = new Set(ids);
  const extras = existsSync(sfxDir)
    ? readdirSync(sfxDir).filter((f) => f.endsWith('.mp3') && !known.has(f.slice(0, -4)))
    : [];
  for (const f of extras) log(`WARN ${f}: not a card/relic id, ignored`);

  if (write) writeFileSync(join(audioDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  return { manifest, rejected, extras, ids };
}

function main(argv) {
  const opts = { audioDir: join(repoRoot, 'assets', 'audio'), htmlPath: join(repoRoot, 'sound_alchemist.html') };
  let requireAll = false;
  let check = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--audio-dir') opts.audioDir = resolve(argv[++i]);
    else if (a === '--html') opts.htmlPath = resolve(argv[++i]);
    else if (a === '--allow-nonconforming') opts.allowNonconforming = true;
    else if (a === '--require-all') requireAll = true;
    else if (a === '--check') check = true;
    else if (a === '-h' || a === '--help') {
      console.log('Usage: node scripts/extract-envelopes.mjs [--audio-dir <dir>] [--html <file>] [--allow-nonconforming] [--require-all] [--check]');
      return 0;
    } else {
      console.error(`Unknown option: ${a}`);
      return 2;
    }
  }

  const manifestPath = join(opts.audioDir, 'manifest.json');
  const before = check && existsSync(manifestPath) ? readFileSync(manifestPath, 'utf8') : null;
  const { manifest, rejected, ids } = buildAll({ ...opts, write: !check });
  const have = Object.keys(manifest.assets).length;
  console.log(`\n${have}/${ids.length} assets with envelopes, ${manifest.missing.length} missing (procedural synth is used for those).`);

  if (rejected.length) return 1;
  if (requireAll && manifest.missing.length) return 1;
  if (check && before !== JSON.stringify(manifest, null, 2) + '\n') {
    console.error('manifest.json is out of date: run node scripts/extract-envelopes.mjs');
    return 1;
  }
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    process.exit(main(process.argv.slice(2)));
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}
