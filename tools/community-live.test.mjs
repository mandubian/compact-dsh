// The launcher itself boots docker and a model route, so it has no unit
// harness — but the URL-persistence contract is small and source-shaped,
// and it exists because an operator lost the boot line mid-run and had no
// way back to the page. This pins the two halves that must not regress:
// the observatory URL is written to the scratch (0600 — the token is a
// bearer credential) and removed when the run ends (a dead token is
// misleading, not a bookmark).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'community-live.mjs'), 'utf8');

test('the observatory URL is persisted for recovery, then removed with the run', () => {
  assert.match(source, /writeFileSync\((\w+), `\$\{observatory\.url\}\\n`, \{ mode: 0o600 \}\)/,
    'the URL file is written with mode 0600 the moment the observatory starts');
  assert.match(source, /observatory\.url/, 'the scratch keeps the URL');
  assert.match(source, /rmSync\(join\(scratch, 'observatory\.url'\), \{ force: true \}\)/,
    'the finally removes the URL when the run ends');
  // and the boot line still says where it is — the SAY names the file
  assert.match(source, /the URL is kept at \$\{observatoryUrlFile\}/);
});

test('Ctrl-C can always stop the run: the second withdraws the human seat, the third exits', () => {
  assert.match(source, /controls\.onStopNow\(\(\) => \{ const n = humanSeat\.cancelPending\(/);
  assert.match(source, /\} else if \(signals === 2\) \{[\s\S]{0,400}controls\.stopNow\(\);/);
  assert.match(source, /exiting NOW[\s\S]{0,200}process\.exit\(130\);/);
  assert.match(source, /card\(s\) wait on the human seat — answer on the page/);
});
