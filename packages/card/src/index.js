// The host half of the ask card is inert by design: the card is a BROWSER
// renderer (lib/client.js) for the approval composer takeover the web surface
// already drives. This plugin exists so the client-modules scanner sees an
// activated loader entry to serve the bundle from (the scan keys on plugin
// activation) and so the composition row has something lawful to mount. It
// decides nothing, provides nothing, and injects nothing — the same posture
// as every envelope rendering: renderings never decide.
export const name = 'compact-card';

export function apply() {}

export default { name, apply };
