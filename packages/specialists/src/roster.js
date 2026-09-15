// The specialist roster — loaded, validated, composed.
//
// Data layout (one source of truth per persona, split for the lint):
//   personas/<id>.persona.json — the descriptor: identity, kind, tool
//     surface (deny list over DSH tool names), delegation budget, canonical
//     includes, gated sections, the output contract (io.returns), and the
//     autonoetic source trace (excluded_tools as declared at home + the
//     categories with no dsh analog, documented — never silently dropped).
//   personas/<id>.md — the prose that is UNIQUE to this persona.
//   personas/shared/<section>.md — canonical doctrine, one place only.
//   personas/<id>.gated.<slug>.md — phase-gated doctrine (when-condition in
//     the descriptor; rendered marked, never silently flattened).
//
// The composer assembles the delivered persona prompt: unique prose, the
// referenced canonical sections, the taught output contract, then the gated
// sections under their applicability marks. The delivered prompt is
// self-contained; the sources are shared. See docs/concept-specialist-personas.md.
//
// Pinned: @deepseek-ai/dsh ~0.1.5-rc.1 (see tools/verify-pin.mjs).

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const PERSONAS_DIR = fileURLToPath(new URL('../personas', import.meta.url));

// The dsh tool vocabulary a deny list may name (the standard composition's
// model-facing surface plus this composition's own tools). The lint pins
// deny lists to this set so a mount against the standard composition cannot
// fail on an unknown name; names outside it are either typos or tools this
// composition does not ship.
export const DSH_TOOL_VOCABULARY = [
  'bash', 'pwsh',
  'read', 'read_image', 'write', 'edit', 'glob', 'grep',
  'skill',
  'todo_write', 'ask_user_question',
  'job_list', 'job_output', 'job_kill',
  'create_goal', 'get_goal', 'update_goal',
  'present',
  'web_search', 'web_fetch',
  'subagent', 'subagent_fork', 'interrupt_agent', 'send_message', 'ralph',
  // this composition's own tools
  'sandbox_request_mount', 'promotion_record',
];

const DESCRIPTOR_RE = /\.persona\.json$/;

export function descriptorFiles(dir = PERSONAS_DIR) {
  return readdirSync(dir).filter(f => DESCRIPTOR_RE.test(f)).sort();
}

export function loadPersona(id, dir = PERSONAS_DIR) {
  const descriptor = JSON.parse(readFileSync(join(dir, `${id}.persona.json`), 'utf8'));
  // Missing include/gated files read as empty text — the lint reports them;
  // a loader exception would hide the specific failure behind a stack trace.
  const read = (rel) => {
    const p = join(dir, rel);
    return existsSync(p) ? readFileSync(p, 'utf8') : '';
  };
  const body = read(`${id}.md`);
  const includes = (descriptor.includes ?? []).map(s => ({
    section: s,
    text: read(`shared/${s}.md`),
  }));
  const gated = (descriptor.gated ?? []).map(g => ({
    ...g,
    text: read(g.file),
  }));
  return { descriptor, body, includes, gated };
}

/** The delivered persona prompt: self-contained, canonical sections assembled. */
export function composePersona(persona) {
  const { descriptor, body, includes, gated } = persona;
  const parts = [body.trimEnd()];
  for (const inc of includes) {
    parts.push(inc.text.trim());
  }
  if (descriptor.io?.returns) {
    parts.push([
      '## Output contract',
      '',
      'Return one JSON object matching this schema (the delegator machine-checks it):',
      '',
      '```json',
      JSON.stringify(descriptor.io.returns, null, 2),
      '```',
    ].join('\n'));
  }
  for (const g of gated) {
    parts.push(`## ${g.heading} (applies when: ${g.when})\n\n${g.text.trim()}`);
  }
  return parts.join('\n\n---\n\n') + '\n';
}

export function loadRoster(dir = PERSONAS_DIR) {
  const personas = descriptorFiles(dir).map(id => loadPersona(id.replace(DESCRIPTOR_RE, ''), dir));
  const byId = new Map();
  for (const p of personas) {
    if (byId.has(p.descriptor.name)) {
      throw new Error(`specialists roster: duplicate persona id ${p.descriptor.name}`);
    }
    byId.set(p.descriptor.name, p);
  }
  return { personas, byId, compose: composePersona };
}
