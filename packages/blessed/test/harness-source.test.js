// The prompt must never name a path the sandbox does not expose (#17). The
// boot bundle's harness-source section carries ITS checkout into the system
// prompt while this composition exposes only the workspace — so the section
// keeps its placement and its text becomes the truth: what is mounted, what is
// not, and where pwd lands. These tests pin all three decisions plus the two
// cases where the rewrite must NOT fire: a checkout the workspace really does
// expose, and a composition (headless) that never carries the section.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  HARNESS_SOURCE_SECTION, claimedCheckoutPath, harnessSourceText,
  rewriteHarnessSourceSection, harnessSourceHonesty,
} from '../src/index.js';

const WORKSPACE = '/tmp/dsh-compact-demo';
const CHECKOUT = '/home/mandubian/workspaces/mandubian/compact-dsh';
const UPSTREAM_TEXT =
  `The DeepSeek Harness implementation checkout is at ${CHECKOUT}. The checkout location and current working directory ` +
  'are separate values and may differ; never infer the working directory from this path. Use pwd to determine the ' +
  'current working directory. Use this checkout only to inspect or extend DSH itself.';

const upstreamSection = (text = UPSTREAM_TEXT) => ({
  name: HARNESS_SOURCE_SECTION,
  order: 1200,
  text,
});

test('an inert checkout claim is rewritten to the exposed workspace — name and placement untouched', () => {
  const other = { name: 'compact:roster-card', order: 1201, text: '## Specialist roster' };
  const { sections, replaced, original } = rewriteHarnessSourceSection([upstreamSection(), other], WORKSPACE);

  assert.equal(replaced, true, 'a path outside the workspace is a promise the sandbox cannot keep');
  assert.equal(original, UPSTREAM_TEXT, 'the superseded claim is returned for the operator log');
  assert.deepEqual(sections.map(s => [s.name, s.order]), [
    [HARNESS_SOURCE_SECTION, 1200],
    ['compact:roster-card', 1201],
  ], 'the section keeps its name and order — upstream owns the placement, the composition owns the wording');
  assert.equal(sections[1], other, 'sections the claim does not touch are passed through untouched');

  const text = sections[0].text;
  assert.match(text, new RegExp(WORKSPACE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), 'the honest text names the workspace');
  assert.ok(!text.includes(CHECKOUT), 'the inert path is gone — it was the defect');
  assert.match(text, /pwd/, 'the operational advice the upstream sentence carried survives the rewrite');
  assert.match(text, /not mounted|outside that boundary/, 'the text says what is NOT reachable, not only what is');
});

test('a checkout the workspace really exposes keeps its own text — the original claim is true there', () => {
  const exposed = upstreamSection(
    `The DeepSeek Harness implementation checkout is at ${CHECKOUT}/packages. The checkout location and current working directory are separate values…`,
  );
  const { sections, replaced } = rewriteHarnessSourceSection([exposed], CHECKOUT);
  assert.equal(replaced, false, 'a path at or under the workspace is mounted — nothing to correct');
  assert.equal(sections[0], exposed, 'and the untouched section is returned as-is');
});

test('the workspace itself is the boundary — inside rewrites, one level above rewrites', () => {
  assert.equal(rewriteHarnessSourceSection([upstreamSection(
    `The DeepSeek Harness implementation checkout is at ${WORKSPACE}. The checkout location…`)], WORKSPACE).replaced, false);
  assert.equal(rewriteHarnessSourceSection([upstreamSection(
    `The DeepSeek Harness implementation checkout is at ${WORKSPACE}-. The checkout location…`)], WORKSPACE).replaced, true,
  'a sibling with the workspace as a string prefix is not inside it');
});

test('a claim this composition cannot parse fails closed into the honest text (D-7)', () => {
  for (const text of ['the checkout lives somewhere', undefined, null, 42]) {
    assert.equal(claimedCheckoutPath(text), null, JSON.stringify(text));
    const { sections, replaced } = rewriteHarnessSourceSection([upstreamSection(text)], WORKSPACE);
    assert.equal(replaced, true, 'an unparseable claim is never guessed into the prompt');
    assert.equal(sections[0].text, harnessSourceText(WORKSPACE));
  }
  assert.equal(
    claimedCheckoutPath('the agent may read: checkout is at /elsewhere. The checkout location…'),
    null,
    'only upstream\'s own sentence is the claim — a stray "checkout is at …" elsewhere is not parsed',
  );
});

test('a composition that carries no such section (headless) is left alone', () => {
  const sections = [{ name: 'harness:identity', order: 1, text: 'You are an AI agent powered by DeepSeek Harness.' }];
  const { sections: out, replaced, original } = rewriteHarnessSourceSection(sections, WORKSPACE);
  assert.equal(replaced, false);
  assert.equal(original, null);
  assert.deepEqual(out, sections);
  for (const notAnArray of [undefined, null]) {
    assert.equal(rewriteHarnessSourceSection(notAnArray, WORKSPACE).replaced, false);
  }
});

test('the section the REAL boot bundle registers is the claim this rewrite corrects (upstream contract)', async () => {
  // pin the parser to the sentence as upstream actually writes it: if dsh
  // rewords the section, this fails here — where the answer is "re-read the
  // claim" — instead of silently rewriting (or not) at the next live run.
  const { addHarnessSourceSection } = await import('@deepseek-ai/dsh-app-boot');
  let registered;
  const systemPrompt = {
    getSectionOrder: () => 1150,
    section: (section) => { registered = section; return () => {}; },
  };
  addHarnessSourceSection({ get: () => systemPrompt }, CHECKOUT);
  assert.equal(registered?.name, HARNESS_SOURCE_SECTION);
  assert.equal(claimedCheckoutPath(registered.text), CHECKOUT, 'the claim parses to the path the bundle named');

  const inert = rewriteHarnessSourceSection([registered], WORKSPACE);
  assert.equal(inert.replaced, true, 'the real claim, against an unrelated workspace, is corrected');
  const home = rewriteHarnessSourceSection([registered], CHECKOUT);
  assert.equal(home.replaced, false, 'the same claim against its own checkout is true and stays');
});

test('the assemble listener rewrites once and tells the operator once, then stays quiet', async () => {
  const notices = [];
  const listener = harnessSourceHonesty(WORKSPACE, text => notices.push(text));
  const build = () => ({ sections: [upstreamSection()], contexts: [] });

  const first = await listener({ sections: [] }, {}, async () => build());
  assert.match(first.sections[0].text, new RegExp(WORKSPACE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.deepEqual(notices, [UPSTREAM_TEXT], 'the first rewrite carries the superseded claim to the operator log');

  const second = await listener({ sections: [] }, {}, async () => build());
  assert.match(second.sections[0].text, /workspace at/, 'every assembly is corrected, not only the first');
  assert.equal(notices.length, 1, 'a per-step prompt is not a per-step alarm');

  const passthrough = { sections: [], contexts: [] };
  assert.equal(await listener(passthrough, {}, async () => passthrough), passthrough,
    'an assembly with nothing to correct is returned by identity');
  const conjured = await listener({}, {}, async () => ({ noSections: true }));
  assert.equal(conjured.noSections, true,
    'an assembly without a section list is never conjured one');
});
