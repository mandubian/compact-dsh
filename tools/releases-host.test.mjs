// The releases host's contract (#240 follow-up, live finding): a PUT
// stores, a GET returns WHAT WAS STORED byte for byte — the publisher
// that verifies its own publish must see the truth, not the receipt.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

import { createReleasesHost } from './releases-host.mjs';

test('releases host: PUT stores, GET serves the stored bytes, unknown paths 404, uploads recorded', async () => {
  const host = await createReleasesHost('127.0.0.1');
  try {
    const body = '# Nightly digest — 2026-10-22\n\nthe whole file, byte for byte\n';
    const put = await fetch(`${host.origin}/digest/2026-10-22`, { method: 'PUT', body });
    assert.equal(put.status, 201);
    const receipt = await put.json();
    assert.equal(receipt.sha256, createHash('sha256').update(body).digest('hex'));

    // the verification round-trip the live publisher attempted: fetch back,
    // hash both sides — they MATCH (the old receiver answered the GET with
    // the PUT's receipt, and the honest verifier flagged the difference)
    const get = await fetch(`${host.origin}/digest/2026-10-22`);
    assert.equal(get.status, 200);
    const served = await get.text();
    assert.equal(served, body);
    assert.equal(createHash('sha256').update(served).digest('hex'), receipt.sha256);

    // an unbodied GET to an unknown path is an honest 404
    const miss = await fetch(`${host.origin}/digest/never-was`);
    assert.equal(miss.status, 404);

    assert.equal(host.uploads.length, 1);
    assert.equal(host.uploads[0].method, 'PUT');
    assert.equal(host.uploads[0].path, '/digest/2026-10-22');
  } finally {
    await host.close();
  }
});
