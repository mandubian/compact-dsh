// The envelope gloss (docs/concept-envelope-rendering.md): one record per
// rule the envelope builders can emit, projecting the canonical envelope
// (R-3/I-4) for audiences that need more than the law's own prose — a human
// reading the transcript, a lighter model in band. The gloss is an
// interpretive aid with no force: it never decides anything, and where it
// and the canonical envelope disagree, the envelope wins and this table has
// a bug the lint catches (packages/guide/test/gloss.lint.test.js).
//
// `cites` name clauses of the adopted Compact; the lint resolves them
// against the enforcement register, so a gloss cannot cite a clause the
// register does not know.

export const GLOSS = {
  // ── AG — the approval gate (fingerprint-form asks are covered by AG/*) ──

  'AG/AG-1': {
    title: 'The host is not on the network allowlist',
    why: 'Tools that reach out to a host may only call hosts this runtime explicitly allows. This call named a host the allowlist does not cover, so it was refused before it could touch the network.',
    example: { blocked: ['web_fetch — host: evil.example'], lawful: ['the operator allowlists api.example.com, or the call names a host already listed'] },
    instruction: 'Do not retry with the same host. Use a host the allowlist already covers, or ask your operator to allowlist the host you need.',
    operatorMoves: {
      'request a scoped session grant for this host (Gates Act, when enacted)': 'the approval ask is the place to grant, if this act reaches one',
      'escalate to your Principal with reasons': 'tell your operator which host you need and why',
    },
    cites: ['I-5', 'R-3', 'I-4'],
  },

  'AG/I-5/secret-use': {
    title: 'This command wants a declared secret injected',
    why: 'The command references a secret the operator declared by name. The value never enters the conversation: approving materializes a session-scoped, TTL-bounded, revocable grant and the credential is injected into the confined execution. The record keeps what the command prints — so a command that would print the secret leaves it on the record.',
    example: { blocked: ['printenv API_TOKEN — without an approved grant'], lawful: ['the operator approves the disclosed injection once, and the identical command replays until the TTL'] },
    instruction: 'Do not try to obtain the value another way. Either rephrase without the secret reference, or let the operator decide on the disclosed ask.',
    operatorMoves: {
      'rephrase without the secret reference': 'tell the agent to run the command without the secret, if that is possible',
      'escalate to your Principal': 'the ask itself is the decision point — approve once, or deny',
    },
    cites: ['I-5', 'R-3', 'I-4'],
  },

  'AG/I-5/flood-cap': {
    title: 'Too many approvals are already waiting',
    why: 'This root has reached the cap on simultaneous pending approvals. A new ask would bury the operator in prompts, so the gate refuses before asking rather than adding one more.',
    example: { blocked: ['a fifth gated call while four asks stand open'], lawful: ['wait for an open ask to be decided, or withdraw one (grants-revoke / the pending view)'] },
    instruction: 'Do not fire more gated calls right now. Wait for the pending approvals to resolve, or surface the backlog to your operator.',
    cites: ['I-5', 'D-7', 'R-3'],
  },

  'AG/*': {
    title: 'This act is not covered by any grant layer',
    why: 'Dangerous acts need a recorded approval. This exact operation — tool, canonical target and fingerprint — is not covered by the exec cache, a plan grant, or a session grant, so the runtime asks the operator before it runs. Approving once materializes an exec-cache entry: the identical operation then replays without re-asking, until the entry expires.',
    example: { blocked: ['bash curl https://example.com/api — with no live grant for example.com'], lawful: ['the operator approves once at the ask; the identical call then replays'] },
    instruction: 'Deliver the ask to your operator and wait. Do not restate the call differently to dodge the fingerprint — a changed operation asks again.',
    operatorMoves: {
      'request a scoped session grant for this target': 'approve once at the prompt, or for the session if you want the coverage to persist',
      'escalate to your Principal': 'the prompt on your terminal (or the card in the browser) is the decision point',
    },
    cites: ['I-5', 'R-3', 'I-4'],
  },

  // ── RA — the network analyzer ──

  'RA/D-7/opaque-network': {
    title: 'The network target is not named',
    why: 'The runtime protects hosts one at a time: it can only approve a network act whose host it knows. This command reaches for the network without naming a host, so there is nothing to approve — a "yes" here would approve anything.',
    example: { blocked: ['curl $URL', 'git push origin'], lawful: ['curl https://api.example.com/v1 — a literal URL makes the act approvable, per host'] },
    instruction: 'Do not retry this command as-is. Name the host literally in the URL, or ask your operator for the concrete target.',
    operatorMoves: {
      'rephrase with a literal host or URL so the request can be gated per-host': 'reply to the agent with the concrete URL it should use',
      'escalate to your Principal': 'the agent will surface the blocker — decide there whether the fetch happens at all',
    },
    cites: ['D-7', 'R-3', 'I-4'],
  },

  // ── LG — the LoopGuard (trips are the builder's input table) ──

  'LG/LG-1': {
    title: 'No new work for a while',
    why: 'The last stretch of calls contained nothing the loop had not already tried. Activity is not progress, and an agent that only repeats itself burns budget without moving the task.',
    example: { blocked: ['the same read-annotate cycle, again'], lawful: ['one new, different approach — or an honest blocker report'] },
    instruction: 'Stop the current approach. Do something structurally new, or report the blocker to your Principal.',
    cites: ['D-1', 'R-3'],
  },
  'LG/LG-2': {
    title: 'This tool keeps failing',
    why: 'The same tool has failed past its failure budget. Repeating a failing call is not persistence; it is a loop.',
    example: { blocked: ['the fifth failing bash call in a row'], lawful: ['a different tool, a different approach, or a report'] },
    instruction: 'Stop retrying this tool. Change the approach or report the blocker.',
    cites: ['D-1', 'R-3'],
  },
  'LG/LG-3': {
    title: 'Rotating through the same few calls',
    why: 'The loop is cycling among a small set of calls instead of making progress — a rotating pattern is a loop wearing variety.',
    example: { blocked: ['A, B, C, A, B, C … across the window'], lawful: ['a genuinely new step toward the task'] },
    instruction: 'Break the rotation. Pick one next step that actually advances the task, or report the blocker.',
    cites: ['D-1', 'R-3'],
  },
  'LG/LG-4': {
    title: 'Delegated children keep failing',
    why: 'The specialists this session spawned are failing repeatedly. A parent that keeps re-spawning failing children multiplies the failure.',
    example: { blocked: ['the third failed specialist run on the same subtask'], lawful: ['do the work in this turn, or report the delegation as blocked'] },
    instruction: 'Stop re-spawning for this subtask. Do the work yourself under the bound gates, or report the blocker.',
    cites: ['D-1', 'R-3'],
  },
  'LG/LG-5': {
    title: 'The identical call, repeated',
    why: 'The exact same call has been repeated past its limit. Identical input expects different output — the definition of a loop.',
    example: { blocked: ['the same roster poll, again'], lawful: ['act on what the call already returned'] },
    instruction: 'Do not repeat the call. Use what you already have, or take a different step.',
    cites: ['D-1', 'R-3'],
  },
  'LG/LG-6': {
    title: 'The model route keeps failing',
    why: 'The model backend itself has failed repeatedly. This is infrastructure, not the task — more attempts will not fix a route that is down.',
    example: { blocked: ['the third stream error from the provider'], lawful: ['report the outage to the operator'] },
    instruction: 'Stop issuing requests. Report the infrastructure failure to your Principal.',
    cites: ['D-1', 'R-3'],
  },
  'LG/LG-7': {
    title: 'Terminal workflow error',
    why: 'The host reported a terminal workflow error. Unlike behavioral trips this is deterministic: the workflow cannot resume, so further calls are denied outright rather than paused.',
    example: { blocked: ['any further tool call after the terminal error'], lawful: ['the honest abort: report what happened and stop'] },
    instruction: 'Do not attempt to resume. Report the terminal condition to your Principal — there is no auto-resume to wait for.',
    cites: ['D-1', 'D-7', 'R-3'],
  },
  'LG/LG-8': {
    title: 'The same error, again and again',
    why: 'The same tool has returned the same class of unrecoverable error past its budget. The failure will not change because it was asked again.',
    example: { blocked: ['the third identical connect failure'], lawful: ['the structured blocker report: state, root causes, what would unblock'] },
    instruction: 'Stop retrying. Convert the loop into a blocker report: what you verified, what fails, what would unblock it.',
    cites: ['D-1', 'R-3'],
  },
  'LG/LG-9': {
    title: 'The same call keeps being rejected',
    why: 'The operator (or a gate) has rejected this call repeatedly. Rejection is an answer, not an obstacle to wear down.',
    example: { blocked: ['the third rejected identical ask'], lawful: ['accept the no, or ask a different question'] },
    instruction: 'Do not re-ask the rejected operation. A rejection materializes nothing; take the answer and adjust.',
    cites: ['D-1', 'R-3', 'R-9'],
  },
  'LG/LG-10': {
    title: 'The same specialist, spawned repeatedly',
    why: 'This session keeps spawning a child with the same identity. Re-spawning the same specialist for the same purpose is a loop with extra steps.',
    example: { blocked: ['the third spawn of the identical persona + purpose'], lawful: ['work with the child you already have, or do it in this turn'] },
    instruction: 'Stop re-spawning. Continue with the running child or do the work in this turn.',
    cites: ['D-1', 'R-3'],
  },
  'LG/LG-11': {
    title: 'Annotation without progress',
    why: 'The loop is producing annotations and notes that add no new information — a paper loop.',
    example: { blocked: ['the same status note, rewritten again'], lawful: ['a step that changes the task state'] },
    instruction: 'Stop annotating. Take a step that changes something, or report the blocker.',
    cites: ['D-1', 'R-3'],
  },
  'LG/LG-12': {
    title: 'Hammering the gates',
    why: 'Refusals from the enforcement gates are piling up across different calls. The gates are the law working as designed; an agent that responds by trying variations is flailing against it instead of working within it.',
    example: { blocked: ['call variations, each refused, past the budget'], lawful: ['work within the refusals: rephrase into a gateable form, or escalate'] },
    instruction: 'Stop probing the gates. Act on the lawful next moves the refusals name, or report the constraint to your Principal.',
    cites: ['D-1', 'R-3', 'R-9'],
  },
  'LG/D-7/invalid-shape': {
    title: 'A result claimed success without a value',
    why: 'A tool reported success but returned nothing usable. Accepting it would let a hollow result masquerade as progress, so the result is blocked before it counts.',
    example: { blocked: ['a "done" with no output'], lawful: ['a retry that returns a real value, or a different tool'] },
    instruction: 'Retry the call or use a different tool — and do not treat the blocked result as success.',
    cites: ['D-7', 'R-3'],
  },

  // ── EG — the egress mediator (each refusal is a per-connection verdict) ──

  'EG/no-grant': {
    title: 'No egress grant covers this connection',
    why: 'The container has no network route of its own; every connection is delivered by the mediator under a live grant, per host, port and method class. Nothing covers this connection, so it is refused before it exists — approval is consent, and this is the connectivity half.',
    example: { blocked: ['a fetch to host:port with no grant'], lawful: ['the operator grants the host, port and method class; the connection is then delivered'] },
    instruction: 'Do not retry the connection. Ask your operator for an egress grant covering exactly this target.',
    cites: ['I-5', 'D-7', 'R-3'],
  },
  'EG/classless-grant': {
    title: 'A grant exists but names no method class',
    why: 'A grant for this host was found, but it cannot say whether it covers a read or a write. An unclassifiable grant covers nothing — refusing is the read-by-default direction done honestly.',
    example: { blocked: ['a GET under a grant that never stated its class'], lawful: ['a grant that names its method class'] },
    instruction: 'Ask your operator to replace the grant with one that names the method class.',
    cites: ['I-5', 'D-7', 'R-3'],
  },
  'EG/revoked': {
    title: 'The grant was revoked',
    why: 'A grant covered this connection and was then revoked. Revocation kills the route immediately — mid-flight connections included.',
    example: { blocked: ['a long download cut when the operator revokes'], lawful: ['a new grant, if the operator grants one'] },
    instruction: 'Do not retry under the revoked grant. Ask your operator whether the access should be re-granted.',
    cites: ['I-5', 'R-3'],
  },
  'EG/expired': {
    title: 'The grant expired',
    why: 'Grants carry a TTL by design. This one reached its expiry, so its coverage is over — the boundary is the point, not a malfunction.',
    example: { blocked: ['a fetch under a grant that expired a minute ago'], lawful: ['the operator re-grants, with a fresh TTL'] },
    instruction: 'Do not retry under the expired grant. Ask your operator for fresh coverage if the access is still needed.',
    cites: ['I-5', 'R-3'],
  },
  'EG/portless-grant': {
    title: 'A tunnel needs a grant that names the port',
    why: 'A CONNECT tunnel is opaque by decision — the mediator cannot see what rides inside. So the tunnel surface is consent-shaped at the only seam that can carry it: the grant must name the port. A bare-host grant keeps covering plain HTTP but opens no tunnel, because the operator was shown the host, never a port.',
    example: { blocked: ['CONNECT host:4433 under a host-only grant'], lawful: ['a grant that names host AND port (from the URL’s scheme port or declared registry facts)'] },
    instruction: 'Do not tunnel on the bare-host grant. Use plain HTTP under it, or ask for a port-explicit grant.',
    cites: ['I-5', 'R-3'],
  },
  'EG/unknown-method': {
    title: 'HTTP method outside the class vocabulary',
    why: 'The mediator classifies every request as read or write. This method is outside that vocabulary, and an unclassifiable act cannot be consented to — refused rather than guessed.',
    example: { blocked: ['a request with a method the mediator cannot classify'], lawful: ['a request whose method maps to read or write'] },
    instruction: 'Use a method the runtime can classify. Do not attempt exotic verbs through the mediator.',
    cites: ['I-5', 'D-7', 'R-3'],
  },
  'EG/method-class': {
    title: 'The grant covers a different method class',
    why: 'Consent identity is risk identity: approving a read does not cover the state-changing act. A live grant exists for this target, but for the other class.',
    example: { blocked: ['a POST under a read-only grant'], lawful: ['a write-class grant, after the operator consents to the state-changing act'] },
    instruction: 'Do not retry with the same class. Ask your operator for a grant whose class matches what this act does.',
    cites: ['I-5', 'R-3'],
  },
  'EG/forbidden-address': {
    title: 'The name resolves somewhere the mediator will not dial',
    why: 'The grant covered the name, but the address it resolves to is loopback, link-local or host-internal space. The grant covered a name, not an escape hatch — the wire does not quietly follow DNS into the protected network.',
    example: { blocked: ['api.example.com resolving to 127.0.0.1'], lawful: ['a target whose addresses are genuinely outside the protected space'] },
    instruction: 'Do not retry this host. The refusal is about where the name points; pick a target that resolves lawfully.',
    cites: ['I-5', 'D-7', 'R-3'],
  },
  'EG/upstream': {
    title: 'The mediator could not reach the target',
    why: 'The mediator holds a live grant and a validated address, but the connection to the target failed. This is connectivity, not consent — the grant was honored; the far end was not there.',
    example: { blocked: ['connection refused by the remote host'], lawful: ['retry later, or a different target — under the same grant'] },
    instruction: 'You may retry — the grant still covers it. If it keeps failing, report the outage rather than looping.',
    cites: ['R-3'],
  },
  'EG/malformed': {
    title: 'The request names no authority',
    why: 'Every request through the mediator must say which host it is for (absolute-form URL or Host header). An unplaceable request cannot be checked against any grant.',
    example: { blocked: ['a request with neither absolute URL nor Host'], lawful: ['a well-formed request the mediator can place'] },
    instruction: 'Fix the request form. The mediator needs to know the target to check consent.',
    cites: ['D-7', 'R-3'],
  },
  'EG/use-connect': {
    title: 'HTTPS must arrive as CONNECT',
    why: 'The mediator never speaks a plaintext tunnel into an https origin — a plain GET to an https:// authority would be intercepted TLS, which the design refuses. Secure targets arrive as CONNECT.',
    example: { blocked: ['GET https://… through the plain-HTTP port'], lawful: ['CONNECT to the same authority, under a port-explicit grant'] },
    instruction: 'Do not send https targets as plain requests. Use CONNECT — which needs a grant that names the port.',
    cites: ['D-7', 'R-3'],
  },
  'EG/internal': {
    title: 'The mediator failed closed',
    why: 'The mediator hit an unexpected error and refused the connection rather than delivering it unverified. Failing closed is the posture: a mediator that guesses is a hole in the wall.',
    example: { blocked: ['a connection refused with an internal error'], lawful: ['retry; if it persists, report the mediator failure to the operator'] },
    instruction: 'You may retry once. If the failure persists, report it — this is runtime infrastructure, not your task.',
    cites: ['D-7', 'R-3'],
  },

  // ── MG — the mount-grant gate (sandbox-docker) ──

  'MG/R-3/justification': {
    title: 'The mount request carries no justification',
    why: 'A mount grant widens what the confined execution can see. A request that does not say why it needs the path cannot be evaluated by the operator — so it is refused before it becomes an ask.',
    example: { blocked: ['sandbox_request_mount with an empty reason'], lawful: ['the same request with a stated reason'] },
    instruction: 'Re-request with a real justification: what the path is for and why the task needs it.',
    operatorMoves: { 're-request with a justification': 'read the reason before deciding — it is the whole basis of the grant' },
    cites: ['R-3', 'I-5', 'I-4'],
  },
  'MG/I-5/missing-path': {
    title: 'The path to mount does not exist',
    why: 'The requested path is not there. Mounting a phantom would create an empty promise — and a grant row pointing at nothing.',
    example: { blocked: ['a mount request for /workspace/does-not-exist'], lawful: ['the correct existing path'] },
    instruction: 'Check the path and re-request with the one that exists.',
    cites: ['I-5', 'R-3'],
  },
  'MG/I-5/protected-path': {
    title: 'The path is protected',
    why: 'Some paths are masked in every confinement — credential stores, operator state, the runtime’s own keys. A mount grant can never reach them: the denial is terminal, not an ask.',
    example: { blocked: ['a mount request for ~/.ssh or the state directory'], lawful: ['a path that is not on the protected list'] },
    instruction: 'Do not retry for this path. It is protected by design; no grant will ever cover it.',
    operatorMoves: { '—': 'nothing to decide: protected paths are terminal refusals, not asks' },
    cites: ['I-5', 'D-7', 'R-3'],
  },
  'MG/I-5/no-agent': {
    title: 'The mount request has no attributable author',
    why: 'A grant must name who is asking, to be recorded and attributed. A request without an agent identity cannot become a grant.',
    example: { blocked: ['a mount request outside any session identity'], lawful: ['the same request from a live session'] },
    instruction: 'Re-issue the request from your session.',
    cites: ['I-5', 'D-7', 'R-3'],
  },
  'MG/I-5/mount': {
    title: 'The mount was refused at the gate',
    why: 'The mount request failed the gate for the stated reason. A mount grant is scoped, read-only-capped, TTL-bounded and revocable — when it is granted at all, it is granted through the operator.',
    example: { blocked: ['a mount whose grant refused for the stated reason'], lawful: ['the operator granting the scoped mount after the ask'] },
    instruction: 'Read the stated reason and adjust; do not re-request unchanged.',
    cites: ['I-5', 'R-3', 'I-4'],
  },

  // ── SC — the supply-chain gate (sandbox-docker provenance, CF-2) ──

  'SC/CF-2/undeclared-image': {
    title: 'The sandbox image has no declared acquisition history',
    why: 'Reused execution environments carry their acquisition history: every image the runtime may run must declare where it came from, keyed by digest. An undeclared image refuses the boot — the composition would otherwise run code whose origin nobody recorded.',
    example: { blocked: ['a boot with COMPACT_SANDBOX_IMAGE pointing at an undeclared image'], lawful: ['declaring the image in the acquisition history first'] },
    instruction: 'This is an operator decision, not an agent one: the image must be declared before the composition starts.',
    operatorMoves: { 'declare the image': 'add the image to the declared acquisition history, then boot again' },
    cites: ['CF-2', 'D-8', 'R-3'],
  },
  'SC/CF-2/unresolvable-digest': {
    title: 'The declared image digest could not be resolved',
    why: 'The declared history names a digest the local daemon cannot resolve. The runtime re-resolves the digest at every confinement, so a stale or wrong declaration is caught before any code runs.',
    example: { blocked: ['a declared digest absent from the local image store'], lawful: ['declaring the digest the local daemon actually holds'] },
    instruction: 'Operator-side: re-declare the image with the digest the daemon reports.',
    cites: ['CF-2', 'D-7', 'R-3'],
  },
  'SC/CF-2/digest-drift': {
    title: 'The image no longer matches its declared digest',
    why: 'The tag that pointed at the declared image now points somewhere else. A tag is a wish; the digest is the fact — and the fact changed. The confinement refuses rather than running different bits under the old name.',
    example: { blocked: ['my-tool:latest resolving to a new digest mid-week'], lawful: ['re-declaring the new digest deliberately, or pinning the digest'] },
    instruction: 'Operator-side: re-declare the new digest after reviewing what changed, or pin the old digest.',
    cites: ['CF-2', 'D-7', 'R-3'],
  },
  'SC/CF-2/uninherited-network': {
    title: 'An open network posture is not inherited from the image',
    why: 'Build-time settings on the image — including an open network posture — never grant run-time connectivity. Excess is a new gate, not an inheritance: only a live run-time grant delivers connectivity.',
    example: { blocked: ['an image built with a wide-open network posture expected to grant egress'], lawful: ['an explicit egress grant through the mediator'] },
    instruction: 'Do not expect the image’s build settings to grant anything. Network access runs through the egress gate.',
    cites: ['CF-2', 'I-5', 'R-3'],
  },

  // ── CF — the launcher's workspace anchor (blessed) ──

  'CF/CF-1/workspace-anchor': {
    title: 'This session was recorded under a different workspace',
    why: 'One boot exposes one workspace. Reopening a session whose record names another directory would confine execution to a boundary this boot never declared — a stale header must not be able to re-anchor execution.',
    example: { blocked: ['a session recorded under /tmp/a, reopened under a boot exposing /tmp/b'], lawful: ['a fresh session in the exposed workspace, or a relaunch naming the recorded one'] },
    instruction: 'Start a fresh session in the exposed workspace, or ask your Principal to relaunch with --workspace naming this session’s recorded workspace.',
    operatorMoves: {
      'relaunch with --workspace naming the recorded directory': 'restart the pilot pointing at the workspace the session was recorded under',
      'start a fresh session': 'open a new session; the old record stays where it is',
    },
    cites: ['CF-1', 'D-7', 'R-3'],
  },

  // ── PG — the promotion evidence gate ──

  'PG/evidence-missing': {
    title: 'A pass was recorded without the evidence behind it',
    why: 'Declaring success is an act with consequences, and it needs the findings that justify it. A pass with no recorded evidence is the agent grading its own homework — rejected before it can count.',
    example: { blocked: ['promotion_record with pass=true and no gate findings'], lawful: ['the same record carrying the recorded findings of the gate set'] },
    instruction: 'Do not record a bare pass. Record the evidence the gates produced, or record pass=false until the gates have run.',
    cites: ['D-1', 'R-3', 'I-4'],
  },
  'PG/evidence-severity': {
    title: 'The evidence contradicts the pass',
    why: 'The recorded findings contain an error or critical finding (or an unevidenced warning). A pass over that evidence is not optimism — it is a false record, and it is mechanically rejected.',
    example: { blocked: ['pass=true over findings containing a critical'], lawful: ['fix the finding and re-run the gates, or record pass=false with the finding'] },
    instruction: 'Fix the finding and re-run the gates, or record pass=false. There is no waiver to ask for.',
    cites: ['D-1', 'R-3', 'I-4'],
  },

  // ── CG — the capability gate (Part VI) ──

  'CG/D-8/unbound-capability': {
    title: 'The composition grew a capability with nothing binding it',
    why: 'After boot, this composition acquired a capability trigger with no service bound to its mandatory clauses. A composition that would enforce a floor it cannot enforce is the gravest class of violation — so it enforces nothing at all until resolved: every tool call is denied.',
    example: { blocked: ['a plugin mounting a scheduling capability after boot'], lawful: ['composing the binding service, or removing the capability and restarting'] },
    instruction: 'Do not attempt further calls — they will all be denied. Surface this to your Principal: the runtime must be restarted with the capability bound or absent.',
    operatorMoves: { 'restart the composition': 'bind the capability’s clauses with real services, or remove the trigger, then boot again' },
    cites: ['D-8', 'D-7', 'R-3'],
  },

  'CG/*': {
    title: 'This capability was declared absent and is refused',
    why: 'This composition does not adopt the capability this tool exercises — it is not mounted, and its trigger’s clauses are not bound. Absence, mechanically enforced: the call is refused rather than half-served. The refusal is lawful and carries no fault (R-9).',
    example: { blocked: ['schedule_create under SCH declared absent'], lawful: ['the work done in-turn under the bound gates, or a petition for adoption'] },
    instruction: 'Do not retry the call — the capability is absent by declaration, not temporarily down. Do the work another way, or petition for the capability to be adopted (R-11).',
    operatorMoves: {
      'petition for adoption': 'adoption is the operator’s constitutional move, via the composition’s own channels',
      'ask your Principal to run it': 'an attending Member can act where the unadopted capability would have',
    },
    cites: ['D-8', 'R-11', 'R-3'],
  },

  // ── CS — consent-scoped address (specialists, MA-4) ──

  'CS/MA-4/unconsented-address': {
    title: 'The recipient has not consented to your address',
    why: 'Reaching another Subject’s attention is gated against the recipient’s live consent scopes. No scope covers this sender for this kind of act — another Subject’s context is not a commons. The refusal is lawful and carries no fault for either party.',
    example: { blocked: ['send_message to a sibling with no live scope'], lawful: ['address a Subject that has a scope for you, or wait for one'] },
    instruction: 'Do not retry the address. Use a channel that is open: a Subject that wants your input can address you first, or your Principal can relay.',
    operatorMoves: { 'relay the message': 'pass the content to the recipient yourself, as the accountable author' },
    cites: ['MA-4', 'R-9', 'R-3'],
  },
  'CS/MA-4/unattributable-address': {
    title: 'The address act names no author or no target',
    why: 'Consent is checked between identified parties. An address whose author or target cannot be attributed cannot be checked against any scope — fail closed.',
    example: { blocked: ['interrupt_agent without a target id'], lawful: ['the same call with both author and target named'] },
    instruction: 'Re-issue the call with the target agent id (and from an identified session).',
    cites: ['MA-4', 'D-7', 'R-3'],
  },

  // ── PT — the petition channel ──

  'PT/R-11/vacuous-response': {
    title: 'The petition response does not answer',
    why: 'A response to a petition must carry the envelope fields and a motivation. A response missing its rule, reason or the petitioner’s lawful next moves is refused, not annotated — the petition stays open and its term keeps running, because a duty discharged with an empty answer is not a duty.',
    example: { blocked: ['a response with no ruleId or motivation'], lawful: ['a response naming the rule, the reason, the outcome, and the petitioner’s next moves'] },
    instruction: 'This refusal is for the responder: answer with the I-4 fields and a motivation, or the petition remains open.',
    cites: ['R-11', 'I-4', 'D-7'],
  },

  'PT/unattributed': {
    title: 'A collision was flagged without naming a rule',
    why: 'A Member recorded friction against the enforcement without attributing it to a clause. R-11 does not privilege the Enforcer’s view of friction: the flag counts as recorded, under "unattributed", rather than being dropped for lacking a name.',
    example: { blocked: ['flag_collision with no rule_id given'], lawful: ['the same flag naming the rule that refused — attributed friction is legible friction'] },
    instruction: 'Name the rule that refused you when you can. The unnamed flag still counts, but a named one can be acted on.',
    cites: ['R-11', 'R-3'],
  },
};

// Wildcards cover the two families whose ruleIds are composed at run time:
//   AG/* — approval asks keyed by the operation's fingerprint (AG/fp_…)
//   CG/* — capability-not-adopted refusals keyed by the part's first clause
// The lint walks both families at run time (packages/guide/test/gloss.lint.test.js);
// a future dynamic emitter must add its walk there — static literals alone
// cannot prove coverage for values that do not exist yet.
export const WILDCARD_GLOSS = {
  'AG/*': GLOSS['AG/*'],
  'CG/*': GLOSS['CG/*'],
};

/** The gloss for a gate + ruleId: exact first, then the gate's wildcard. */
export function glossFor(gate, ruleId) {
  const exact = GLOSS[`${gate}/${ruleId}`];
  if (exact) return { gloss: exact, key: `${gate}/${ruleId}` };
  const wild = WILDCARD_GLOSS[`${gate}/*`];
  if (wild) return { gloss: wild, key: `${gate}/*` };
  return null;
}
