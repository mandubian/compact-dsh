import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Context } from '@deepseek-ai/cordis';
import { SessionStore, SESSION_FORMAT_VERSION } from '@deepseek-ai/dsh-session';
import { SessionAlreadyOwnedError, SessionHandleClosedError, SessionReadOnlyError } from '@deepseek-ai/dsh-session-persistence';
import provider, { apply } from 'compact-dsh-record/provider';
import { extendChain, genesisHash, verifySlice } from '../src/index.js';

const event = (seq) => ({ type: 'turn/start', seq, time: 1_700_000_000_000 + seq, data: { turn: seq + 1 } });
const header = (id) => ({ version: SESSION_FORMAT_VERSION, id, createdAt: 1_700_000_000_000, isSeeded: false });

function paths(t) {
  const dir = mkdtempSync(join(tmpdir(), 'compact-provider-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return { root: join(dir, 'sessions'), chainDir: join(dir, 'chains'), compression: 'none' };
}

async function boot(t, config) {
  const ctx = new Context();
  t.after(() => ctx.fiber.dispose());
  const fiber = await ctx.plugin(provider, config);
  return { ctx, fiber, persistence: ctx.get('sessionPersistence'), record: ctx.get('compact-record') };
}

test('provider: public create/open/read/write/metadata and fresh cross-handle chains survive restart', async (t) => {
  const config = paths(t);
  const first = await boot(t, config);
  const { persistence, record } = first;
  assert.equal(record.chained, persistence);
  assert.equal(record.declaredGaps.length, 1);
  assert.equal(persistence.inner, undefined);
  assert.equal(persistence.store, undefined);
  assert.equal(persistence.updateHeader, undefined);
  assert.equal(persistence.fork, undefined);
  const writer = await persistence.create(header('restart'));
  assert.deepEqual(writer.header, header('restart'));
  assert.equal(writer.inheritedEventCount, 0);
  assert.equal(writer.access, 'write');
  assert.equal((await persistence.stat(writer.id)).header.id, writer.id);
  assert.equal((await persistence.list()).length, 1);
  const reader = await persistence.open(writer.id, 'read');
  assert.deepEqual((await reader.read()).events, []);
  await assert.rejects(persistence.open(writer.id, 'write'), SessionAlreadyOwnedError);
  await Promise.all([writer.append([event(0)]), writer.append([event(1)])]);
  await persistence.flush();
  assert.deepEqual((await reader.read()).events, [event(0), event(1)]);
  assert.deepEqual((await reader.read(1, 1)).events, [event(1)]);
  const expected = extendChain(genesisHash(writer.id), 0, [event(0), event(1)]).at(-1).h;
  assert.equal(record.head(writer.id), expected);
  assert.match(readFileSync(join(config.root, '_no-cwd', writer.id, 'session.v3.jsonl'), 'utf8'), /turn\/start/);
  assert.equal(readFileSync(join(config.chainDir, `${writer.id}.chain`), 'utf8').trim().split('\n').length, 2);
  await reader[Symbol.asyncDispose]();
  await first.fiber.dispose();
  assert.equal(first.ctx.get('sessionPersistence'), undefined);
  assert.equal(first.ctx.get('compact-record'), undefined);
  await assert.rejects(writer.read(), SessionHandleClosedError);
  const second = await boot(t, config);
  const reopened = await second.persistence.open('restart', 'write');
  await reopened.append([event(2)]);
  await reopened.flush();
  await reopened.close();
  assert.deepEqual(await second.record.verify('restart'), { ok: true, events: 3 });
  const restored = await second.persistence.open('restart', 'read');
  assert.deepEqual((await restored.read()).events, [event(0), event(1), event(2)]);
  await restored.close();
});

test('provider: consumers wait for public services and unload before provider restart', async (t) => {
  const config = paths(t);
  const ctx = new Context();
  t.after(() => ctx.fiber.dispose());
  let starts = 0;
  let stops = 0;
  const consumer = ctx.plugin({
    inject: ['sessionPersistence', 'compact-record'],
    apply(scope) {
      assert.equal(scope.sessionPersistence, scope['compact-record'].chained);
      starts++;
      return () => { stops++; };
    },
  });
  await consumer;
  assert.equal(starts, 0);
  const fiber = await ctx.plugin(provider, config);
  await consumer;
  assert.equal(starts, 1);
  await fiber.restart();
  await consumer;
  assert.equal(starts, 2);
  assert.equal(stops, 1);
  await fiber.dispose();
  await consumer;
  assert.equal(stops, 2);
  assert.equal(ctx.get('sessionPersistence'), undefined);
});

test('provider: real SessionStore live events drain through the public chain on flush and teardown', async (t) => {
  const config = paths(t);
  const { ctx, fiber, persistence, record } = await boot(t, config);
  await ctx.plugin(SessionStore);
  const sessions = ctx.get('sessions');
  const session = sessions.prepare('live');
  const writer = await persistence.create(session.header);
  const detach = sessions.enter(session);
  sessions.announce(session);
  session.append('turn/start', { turn: 1 });
  session.append('turn/end', { turn: 1 });
  assert.equal(await sessions.flush(session), true);
  assert.deepEqual(await record.verify(session.id), { ok: true, events: 2 });
  assert.deepEqual((await writer.read()).events, session.snapshotEvents());
  session.append('turn/start', { turn: 2 });
  await persistence.flush();
  assert.equal(record.store.load(session.id).lastSeq, 2);
  session.append('turn/end', { turn: 2 });
  detach();
  await writer.close();
  assert.deepEqual(await record.verify(session.id), { ok: true, events: 4 });
  const reopened = await persistence.open(session.id, 'write');
  const again = sessions.prepare(session.id, {
    seed: (await reopened.read()).events, meta: reopened.header, inheritedEventCount: 0,
  });
  await reopened.append(again.snapshotEvents(again.firstLiveSeq));
  const detachAgain = sessions.enter(again);
  sessions.announce(again);
  again.append('turn/start', { turn: 3 });
  await fiber.dispose();
  detachAgain();
  assert.equal(record.store.load(session.id).lastSeq, 5);
});

test('provider: seeded creation preserves fork metadata and binds inherited events to child identity', async (t) => {
  const config = paths(t);
  const { persistence, record, fiber } = await boot(t, config);
  const meta = { ...header('child'), isSeeded: true, parentSession: 'parent', delegationDepth: 0 };
  const writer = await persistence.create(meta, { inheritedEventCount: 2 });
  await writer.append([event(0), { ...event(1), type: 'turn/end' }]);
  await writer.append([{ ...event(2), type: 'session/end-seed', data: { inherited: true } }]);
  await writer.close();
  await fiber.dispose();
  const next = await boot(t, config);
  const reader = await next.persistence.open('child', 'read');
  assert.deepEqual(reader.header, meta);
  assert.equal(reader.inheritedEventCount, 2);
  const { events } = await reader.read();
  assert.ok(verifySlice({ sessionId: 'child', firstSeq: 0, events, links: record.store.load('child').links }));
  assert.deepEqual(await next.record.verify('child'), { ok: true, events: 3 });
  await reader.close();
});

test('provider: cancellation, read-only and closed handles leave commitments unchanged', async (t) => {
  const { persistence, record } = await boot(t, paths(t));
  const writer = await persistence.create(header('contract'));
  const signal = AbortSignal.abort(new Error('cancelled'));
  await assert.rejects(writer.append([event(0)], { signal }), /cancelled/);
  assert.equal(record.head(writer.id), genesisHash(writer.id));
  await writer.append([event(0)]);
  const head = record.head(writer.id);
  const reader = await persistence.open(writer.id, 'read');
  await assert.rejects(reader.append([event(1)]), SessionReadOnlyError);
  await assert.rejects(reader.flush(), SessionReadOnlyError);
  await assert.rejects(persistence.stat(writer.id, { signal }), /cancelled/);
  await assert.rejects(persistence.list({ signal }), /cancelled/);
  await assert.rejects(persistence.open(writer.id, 'read', { signal }), /cancelled/);
  await assert.rejects(writer.read(0, undefined, { signal }), /cancelled/);
  await writer.close();
  await assert.rejects(writer.append([event(1)]), SessionHandleClosedError);
  await assert.rejects(writer.flush(), SessionHandleClosedError);
  assert.equal(record.head(writer.id), head);
  await reader.close();
});

test('provider: explicit operator paths are required and manual apply returns void', async (t) => {
  const config = paths(t);
  for (const bad of [{}, { root: config.root }, { ...config, chainDir: ' ' }]) {
    const ctx = new Context();
    t.after(() => ctx.fiber.dispose());
    await assert.rejects(async () => { await ctx.plugin(provider, bad); });
    assert.equal(ctx.get('sessionPersistence'), undefined);
    assert.equal(ctx.get('compact-record'), undefined);
  }
  const ctx = new Context();
  t.after(() => ctx.fiber.dispose());
  assert.equal(await apply(ctx, config), undefined);
  assert.ok(ctx.get('sessionPersistence'));
});
