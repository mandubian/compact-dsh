// The operator's model configuration, the way the pre-0.2.0 harness read it:
// `$DSH_HOME/settings.yaml`, keyed by entry id (`llm-pi-ai.providers`,
// `agent-default-model`, ...). dsh 0.2.0 removed the document outright — the
// settings service is `disabled: !ctx.get('profileContext')` (the compact
// launcher never boots a profile), and the one-time legacy import that moves
// the file into a profile therefore never runs in this composition. The
// launcher bridges the gap instead: this module translates the document into
// patch rows appended AFTER the bundle layers, where patch semantics (last
// write wins per row) give the operator's values precedence over the bundles'
// defaults. The file stays where it is and is re-read every boot — this is
// the operator's live config, not a one-time migration.
//
// The section→entry map mirrors dsh-settings' LEGACY_SECTION_ENTRIES (the
// removed settings.yaml sections whose owning entry carries another id).
// Sections naming entries the active surface does not mount are skipped with
// a notice, never silently; a document that does not parse refuses the boot —
// silently ignoring a broken model config is exactly the drift this bridge
// exists to prevent.
import { readFileSync, existsSync } from 'node:fs';
import yaml from 'js-yaml';

const LEGACY_SECTION_ENTRIES = {
  'ui-developer-tools': 'ui-settings',
  'ui-onboarding': 'ui-settings-general',
  // the base bundle composes one shell executor per platform
  shell: process.platform === 'win32' ? 'pwsh-sandbox' : 'bash-sandbox',
};

/** Entry ids that exist only on the web surface (dsh-web-app bundle rows). */
const WEB_ONLY_PREFIX = 'ui-';

/**
 * Translate the operator's settings.yaml into patch rows for this boot.
 * @param {object} options
 * @param {string} options.settingsPath - absolute path of the operator document
 *   ($DSH_HOME/settings.yaml); absent file yields no rows.
 * @param {boolean} options.web - whether this boot mounts the web surface.
 * @param {(notice: string) => void} [options.notice] - called for every skipped
 *   section, so a section that is never applied is said out loud.
 * @returns {Array<object>} patch rows ({ id, config }), in document order.
 */
export function operatorSettingsRows({ settingsPath, web, notice = () => {} }) {
  if (!existsSync(settingsPath)) return [];
  let document;
  try {
    document = yaml.load(readFileSync(settingsPath, 'utf8'));
  } catch (cause) {
    throw new Error(`operator settings: ${settingsPath} does not parse: ${cause.message}`);
  }
  if (document === null || document === undefined) return [];
  if (typeof document !== 'object' || Array.isArray(document)) {
    throw new Error(`operator settings: ${settingsPath} must be a mapping of entry ids to config`);
  }
  const rows = [];
  for (const [section, values] of Object.entries(document)) {
    const entry = LEGACY_SECTION_ENTRIES[section] ?? section;
    if (!web && entry.startsWith(WEB_ONLY_PREFIX)) {
      notice(`operator settings: section "${section}" is web-surface config (${entry}) — not applied to this headless boot`);
      continue;
    }
    if (values === null || typeof values !== 'object' || Array.isArray(values)) {
      throw new Error(`operator settings: section "${section}" must be a mapping of config for entry "${entry}"`);
    }
    rows.push({ id: entry, config: values });
  }
  return rows;
}
