// Composed test — the record discipline over the REAL JSONL persistence
// backend: a real Cordis composition, a real session written to disk, real
// tampering applied to the stored artifact, and the read that refuses it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Context } from '@deepseek-ai/cordis';
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl';
import { SESSION_FORMAT_VERSION } from '@deepseek-ai/dsh-session';
import * as record from '../src/index.js';
import { ChainStore, RecordIntegrityError, genesisHash, verifySlice } from '../src/index.js';

const EV = (seq, data) => ({ type: 'turn/start', seq, time: 1_700_000_000_000 + seq, data });
const header = (id) => ({ version: SESSION_FORMAT_VERSION, id, createdAt: Date.now(), isSeeded: false });

async function boot() {
  const root = mkdtempSync(join(tmpdir(), 'compact-rec-sessions-'));
  const chainDir = mkdtempSync(join(tmpdir(), 'compact-rec-chain-'));
  const ctx = new Context();
  ctx.plugin(JsonlSessionPersistence, { root, compression: 'none' });
  const store = new ChainStore(chainDir);
  record.apply(ctx, { store });
  if (typeof ctx.start === 'function') await ctx.start();
  for (let i = 0; i < 500 && (ctx.get('sessionPersistence') === undefined || ctx.get('compact-record') === undefined); i++) {
    await new Promise(r => setImmediate(r));
  }
  return { ctx, store, root, service: ctx.get('compact-record') };
}

test('composed: the decorator mounts over the real backend and declares its gap', async () => {
  const { service } = await boot();
  assert.ok(service, 'the record service is composed');
  assert.equal(service.declaredGaps.length, 1);
  assert.match(service.declaredGaps[0], /tamper-EVIDENT, not tamper-proof/);
  assert.match(service.declaredGaps[0], /I-1 debt, declared/);
});

test('composed: a session written through the chain reads back and verifies', async () => {
  const { service, store } = await boot();
  const handle = await service.chained.create(header('sess-clean'));
  try {
    await handle.append([EV(0, { turn: 1 }), EV(1, { turn: 2 })]);
    await handle.append([EV(2, { turn: 3 })]);
    await handle.flush();
    const { events } = await handle.read(0);
    assert.equal(events.length, 3);
  } finally {
    await handle.close();
  }
  assert.equal(store.load('sess-clean').lastSeq, 2, 'every appended act is committed to the chain');
  assert.deepEqual(await service.verify('sess-clean'), { ok: true, events: 3 });
});

test('composed: a session written AROUND the chain fails verification (the auditor\'s case)', async () => {
  const { ctx, service } = await boot();
  // the undecorated backend is what an actor bypassing the discipline would use
  const raw = await ctx.get('sessionPersistence').create(header('sess-smuggled'));
  try {
    await raw.append([EV(0, { turn: 1 })]);
    await raw.flush();
  } finally {
    await raw.close();
  }
  await assert.rejects(() => service.verify('sess-smuggled'),
    (e) => e instanceof RecordIntegrityError && e.kind === 'missing-link');
});

test('composed: an act altered in the stored artifact is caught on the next read', async () => {
  const { ctx, service, root } = await boot();
  const handle = await service.chained.create(header('sess-tampered'));
  try {
    await handle.append([EV(0, { turn: 1, act: 'approve' }), EV(1, { turn: 2 })]);
    await handle.flush();
  } finally {
    await handle.close();
  }

  // Rewrite history the way someone with disk access would: the same event
  // shape, the same seq, the same line count — only the content changes. This
  // is the state the host's own validation cannot distinguish from the truth.
  const artifact = join(root, '_no-cwd', 'sess-tampered', 'session.v3.jsonl');
  const lines = readFileSync(artifact, 'utf8').split('\n');
  const i = lines.findIndex(l => l.includes('"act":"approve"'));
  assert.ok(i >= 0, 'the approval is on disk in the clear');
  lines[i] = lines[i].replace('"act":"approve"', '"act":"reject"');
  writeFileSync(artifact, lines.join('\n'));

  // The log still parses, still validates, still has the right seqs — and is
  // no longer evidence.
  await assert.rejects(() => service.verify('sess-tampered'),
    (e) => e instanceof RecordIntegrityError && e.kind === 'broken-link' && e.seq === 0);
});

test('composed: a history presented under another identity is refused (R-7)', async () => {
  const { service } = await boot();
  const handle = await service.chained.create(header('sess-mine'));
  let events;
  try {
    await handle.append([EV(0, { act: 'approve' })]);
    await handle.flush();
    ({ events } = await handle.read(0));
  } finally {
    await handle.close();
  }
  assert.throws(
    () => verifySlice({ sessionId: 'sess-someone-else', firstSeq: 0, events, links: service.store.load('sess-mine').links }),
    (e) => e instanceof RecordIntegrityError,
    'one Member\'s chain does not vouch for a history attributed to another');
});

test('composed: the head link is what an auditor keeps to detect a later rewrite', async () => {
  const { service } = await boot();
  assert.equal(service.head('sess-head'), genesisHash('sess-head'), 'an unwritten session is at genesis');
  const handle = await service.chained.create(header('sess-head'));
  try {
    await handle.append([EV(0, { turn: 1 })]);
    await handle.flush();
  } finally {
    await handle.close();
  }
  const head = service.head('sess-head');
  assert.match(head, /^[0-9a-f]{64}$/);
  assert.notEqual(head, genesisHash('sess-head'), 'the head moved with the act');
});

test('composed: the chain survives a restart — a new store over the same directory continues it', async () => {
  const { service, store } = await boot();
  const handle = await service.chained.create(header('sess-restart'));
  try {
    await handle.append([EV(0, { turn: 1 })]);
    await handle.flush();
  } finally {
    await handle.close();
  }
  const reloaded = new ChainStore(store.dir);
  assert.equal(reloaded.load('sess-restart').lastSeq, 0, 'a link that does not survive a restart is not a commitment');
  assert.equal(reloaded.load('sess-restart').links.get(0), store.load('sess-restart').links.get(0));
});
