// The end-to-end probe's wiring test: the probe itself is the proof (see
// docs/dist-probe.md for the captured transcript), and this suite keeps it
// honest without paying its full cost on every `npm test` — the static
// surface is asserted here, the live run behind COMPACT_DIST_PROBE=1
// (pnpm + docker + minutes), the way test:live gates its own weight.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PROBE = join(ROOT, 'tools', 'dist-probe.mjs');

test('the probe script exists, is wired as dist:probe, and names its fidelity rules', async () => {
  const source = readFileSync(PROBE, 'utf8');
  for (const rule of [
    'compact code runs from the profile',
    'no launcher env',
    'llm/stream',
    'COMPACT_SANDBOX_IMAGE',
  ]) {
    assert.ok(source.toLowerCase().includes(rule.toLowerCase()) || source.includes(rule), `the probe must state: ${rule}`);
  }
  const manifest = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  assert.equal(manifest.scripts['dist:probe'], 'node tools/dist-probe.mjs');
  assert.equal(manifest.scripts['test:dist-probe'], 'COMPACT_DIST_PROBE=1 node --test tools/dist-probe.test.mjs');
});

test('live: the probe passes end to end', { skip: process.env.COMPACT_DIST_PROBE !== '1' ? 'set COMPACT_DIST_PROBE=1 (pnpm + docker + minutes — see docs/dist-probe.md)' : false }, async () => {
  const out = join(tmpdir(), `dist-probe-test-${process.pid}`);
  rmSync(out, { recursive: true, force: true });
  try {
    execFileSync('node', [PROBE, '--out', out], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });
    const transcript = JSON.parse(readFileSync(join(out, 'probe-transcript.json'), 'utf8'));
    assert.equal(transcript.ok, true);
    assert.equal(transcript.llmRequests, 0);
    assert.equal(transcript.verdict.verdict, 'conforming');
    assert.equal(transcript.verdict.chain, 'verified');
    assert.ok(transcript.events >= 6, `the record must carry the posture facts and the approval pair, got ${transcript.events}`);
    assert.ok(existsSync(join(out, 'profiles', 'compact', 'compact-data', 'chains', `${transcript.sessionId}.chain`)), 'the chain must live under the profile dir');
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});
