// The workflows run on GitHub's runners with this repository's token. A
// `${{ … }}` expression inside a `run:` script is pasted into the shell
// BEFORE the shell parses it, so any untrusted event field there (a PR
// title, a branch name, a comment) is code. The baseline guard pasted the
// PR title: a title with a double quote split the guard's arguments and
// failed the check (#289), and a crafted title could have run commands.
// Untrusted fields reach scripts through `env:` only.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const dir = join(root, '.github', 'workflows');
const workflows = readdirSync(dir).filter((f) => /\.ya?ml$/.test(f));

// the contexts an outsider controls (GitHub's own list of untrusted input)
const UNTRUSTED = /\$\{\{\s*(github\.event\.|github\.head_ref|inputs\.)/;

/** Every line of every `run:` script, with its line number. */
export function runScriptLines(text) {
  const lines = text.split('\n');
  const out = [];
  for (let i = 0; i < lines.length; i += 1) {
    const m = /^(\s*)(?:-\s+)?run:\s*(.*)$/.exec(lines[i]);
    if (!m) continue;
    const indent = m[1].length;
    const inline = m[2].trim();
    if (inline && !/^[|>][-+]?$/.test(inline)) { out.push({ line: i + 1, text: inline }); continue; }
    for (let j = i + 1; j < lines.length; j += 1) {
      if (lines[j].trim() === '') continue;
      if (lines[j].search(/\S/) <= indent) break;
      out.push({ line: j + 1, text: lines[j] });
    }
  }
  return out;
}

test('no workflow pastes an untrusted event field into a run: script', () => {
  assert.ok(workflows.length > 0, 'the workflows are found');
  for (const f of workflows) {
    for (const { line, text } of runScriptLines(readFileSync(join(dir, f), 'utf8'))) {
      assert.doesNotMatch(text, UNTRUSTED, `${f}:${line} pastes untrusted input into a script — pass it through env: instead`);
    }
  }
});

test('the reader finds scripts in both shapes — and catches the #289 shape', () => {
  const pasted = [
    'steps:',
    '  - name: guard',
    '    run: |',
    '      node tools/baseline-guard.mjs \\',
    '        --title "${{ github.event.pull_request.title }}"',
    '  - run: echo "${{ github.head_ref }}"',
  ].join('\n');
  const scripts = runScriptLines(pasted);
  assert.equal(scripts.filter((s) => UNTRUSTED.test(s.text)).length, 2);
  const safe = [
    '  - name: guard',
    '    env:',
    '      PR_TITLE: ${{ github.event.pull_request.title }}',
    '    run: |',
    '      node tools/baseline-guard.mjs --title "$PR_TITLE"',
  ].join('\n');
  assert.equal(runScriptLines(safe).filter((s) => UNTRUSTED.test(s.text)).length, 0, 'env: is where untrusted input belongs');
});
