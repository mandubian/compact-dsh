// The guide's honesty is its citations. Every backticked, prefixed name a page
// uses is resolved here against the code that owns it; a page naming a tool,
// command, env var, flag, clause, file or page that does not exist fails the
// build. (Tool citations are ALSO resolved against the live composition by the
// blessed loader test — this suite is the fast static half.)
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { clauseOf } from 'compact-dsh-constitution';
import { PAGES, answer, citationsIn, searchPages, renderPage, CITATION_KINDS, apply } from '../src/index.js';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));

function filesUnder(dir, keep) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const p = join(dir, d.name);
    if (d.isDirectory()) return d.name === 'node_modules' || d.name === 'test' ? [] : filesUnder(p, keep);
    return keep(d.name) ? [p] : [];
  });
}

const packages = readdirSync(join(ROOT, 'packages'));
const SOURCES = packages.flatMap(p => filesUnder(join(ROOT, 'packages', p, 'src'), n => n.endsWith('.js')))
  .map(f => readFileSync(f, 'utf8'));
const PATCHES = packages.map(p => join(ROOT, 'packages', p, 'cordis.patch.yml')).filter(existsSync)
  .map(f => readFileSync(f, 'utf8'));
const PERSONAS = filesUnder(join(ROOT, 'packages', 'specialists', 'personas'), n => n.endsWith('.persona.json'))
  .map(f => JSON.parse(readFileSync(f, 'utf8')));
const LAUNCHER = readFileSync(join(ROOT, 'tools', 'compact-dsh.mjs'), 'utf8');
const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Each resolver answers: does the thing this citation names exist?
const RESOLVE = {
  clause: ref => clauseOf(ref) != null,
  // a tool is defined in some package's source (defineTool name or a named
  // constant), or is a specialist persona's delegation tool
  tool: ref => SOURCES.some(s => new RegExp(`name: '${esc(ref)}'|_TOOL = '${esc(ref)}'|TOOL_NAME = '${esc(ref)}'`).test(s)) ||
    PERSONAS.some(p => p.toolName === ref) ||
    // the host's own tools the composition keeps (the loader test proves they are live)
    ['bash'].includes(ref),
  // commands are registered by name without the slash
  command: ref => ref.startsWith('/') && SOURCES.some(s => s.includes(`name: '${ref.slice(1)}'`)),
  // read by the launcher, a plugin, or a composition patch — or documented by
  // the launcher's own usage text (host-read variables such as the model key)
  env: ref => /^[A-Z][A-Z0-9_]*$/.test(ref) && [LAUNCHER, ...SOURCES, ...PATCHES].some(s =>
    new RegExp(`process\\.env\\.${esc(ref)}\\b|^\\s*${esc(ref)}:`, 'm').test(s)) ||
    new RegExp(`Usage:[^\\n]*\\b${esc(ref)}\\b`).test(LAUNCHER),
  flag: ref => ref.startsWith('--') && new RegExp(`^\\s*'?${esc(ref.slice(2))}'?: \\{ type:`, 'm').test(LAUNCHER),
  file: ref => existsSync(join(ROOT, ref)),
  page: ref => PAGES.some(p => p.id === ref),
};

test('every citation kind has a resolver', () => {
  assert.deepEqual(Object.keys(RESOLVE).sort(), [...CITATION_KINDS].sort());
});

test('every citation on every page resolves against the code', () => {
  const broken = [];
  for (const page of PAGES) {
    for (const c of page.citations) {
      if (!RESOLVE[c.kind](c.ref)) broken.push(`${page.id}: \`${c.kind}:${c.ref}\``);
    }
  }
  assert.deepEqual(broken, [], 'a page names something this runtime does not have — fix the page, never the resolver');
});

test('the resolvers reject what does not exist (the check can fail)', () => {
  assert.equal(RESOLVE.clause('R-99'), false);
  assert.equal(RESOLVE.tool('wiki_get'), false);
  assert.equal(RESOLVE.command('/grants-delete'), false);
  assert.equal(RESOLVE.env('COMPACT_DIGEST'), false, 'an exported constant is not an env var');
  assert.equal(RESOLVE.env('COMPACT_NOT_A_KNOB'), false);
  assert.equal(RESOLVE.flag('--yolo'), false);
  assert.equal(RESOLVE.file('docs/no-such-page.md'), false);
  assert.equal(RESOLVE.page('no-such-page'), false);
});

test('a surface name written without its prefix is not a citation — pages must cite, never paraphrase', () => {
  // any backticked token shaped like one of our tools/env vars/flags must be cited in prefixed form
  const loose = [];
  for (const page of PAGES) {
    for (const m of page.text.matchAll(/`([^`\s]+)`/g)) {
      const tok = m[1];
      if (/^(COMPACT_|DSH_|DEEPSEEK_)[A-Z0-9_]+$/.test(tok) || /^--[a-z-]+$/.test(tok) ||
          /^\/[a-z]+-[a-z-]+$/.test(tok) || RESOLVE.tool(tok)) {
        loose.push(`${page.id}: \`${tok}\``);
      }
    }
  }
  assert.deepEqual(loose, [], 'cite these as `env:…`, `flag:…`, `command:/…` or `tool:…` so the check can see them');
});

test('every page names source docs that exist, and every page is cited at least once from the index page', () => {
  for (const p of PAGES) {
    for (const s of p.sources) assert.ok(existsSync(join(ROOT, s)), `${p.id}: source ${s} does not exist`);
  }
  const overview = PAGES.find(p => p.id === 'overview');
  assert.ok(overview, 'the guide has an overview page');
  const linked = new Set(overview.citations.filter(c => c.kind === 'page').map(c => c.ref));
  for (const p of PAGES) if (p.id !== 'overview') assert.ok(linked.has(p.id), `overview does not link page:${p.id}`);
});

test('a served page carries its standing: an aid, below the law, the attestation and the envelope', () => {
  for (const p of PAGES) {
    const text = renderPage(p);
    assert.match(text, /interpretive aid with no force/);
    assert.match(text, /law_read/);
    assert.match(text, /self_describe/);
  }
});

test('answer: index, page, unknown page, query, empty query', () => {
  const index = answer();
  for (const p of PAGES) assert.ok(index.includes(`${p.id} — ${p.title}`));
  assert.ok(answer({ page: 'overview' }).includes(PAGES.find(p => p.id === 'overview').text.trim()));
  assert.match(answer({ page: 'OVERVIEW' }), /\(page overview/);
  assert.match(answer({ page: 'nope' }), /There is no page "nope"/);
  assert.match(answer({ query: 'zzqqxx' }), /No page matches "zzqqxx".*say so rather than guess/s);
  assert.ok(searchPages('grant').length > 0);
});

test('citationsIn parses only the prefixed forms', () => {
  assert.deepEqual(citationsIn('see `tool:law_read` and `clause:R-6`, not `law_read`'),
    [{ kind: 'tool', ref: 'law_read' }, { kind: 'clause', ref: 'R-6' }]);
});

test('apply: registers the tool and provides the service', () => {
  const registered = [];
  const provided = {};
  const ctx = {
    inject: (_deps, fn) => fn({ tools: { register: t => registered.push(t) } }),
    provide: (n, s) => { provided[n] = s; },
  };
  const service = apply(ctx);
  assert.equal(registered.length, 1);
  assert.equal(registered[0].name ?? registered[0].definition?.name, 'guide');
  assert.equal(provided['compact-guide'], service);
  assert.ok(service.citedTools().includes('law_read'));
});
