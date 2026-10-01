// The member roll — the community's append-only ledger of identity events
// (I-1, docs/concept-member-identity.md §"What a Member key IS" and
// §"Anchoring the roll"). Identity slice 1 (#124).
//
// THE UNIT IS THE MEMBER, NOT THE SESSION AND NOT THE RUNTIME: a Member
// identity is a keypair plus a lineage — the private half held by the
// Member, the public half bound into the roll by an admission event, and
// the standing readable from roll rows and nothing else. The discipline is
// deliberately anti-certificate (the page's own table): admission is
// statute-shaped (F-8) — signed by whoever the statute empowers, plus the
// Member's OWN key, because possession is proven by signing and never
// asserted by a third party; rotation carries its own proof — the successor
// row is signed by the PREDECESSOR key, so re-keying launders nothing and
// the lineage is data; revocation is a fact, not an absence — revoked rows
// stay, verify, and say revoked.
//
// THE CHAIN IS THE SESSION RECORD'S OWN DISCIPLINE, held at community
// scale: entryHash = H(prev, seq, canonical(event)), genesis seeded from
// the roll's own genesis block (epoch length, statute digest, declarations)
// so a roll lifted onto another genesis fails at its first link — the same
// binding the session chain gets from its session id.
//
// ANCHORING (§"Anchoring the roll"): a hash chain proves continuity, and a
// forger reads that as an invitation — a fabricated roll verifies against
// itself, and a fork verifies on both sides of the split. The checkpoint is
// the answer: at each epoch the roll's head digest is folded into a sealed
// instrument (k-of-n under the authority keyring, subject 'roll-checkpoint'
// — an amendment-class act, a spending policy for the root's attention,
// cadence fixed in the genesis constants, never a runtime knob). The walk a
// Witness runs: verify the seal, read rollHead, hash-walk the offered
// lineage until it lands on EXACTLY that digest. A fork BEFORE the
// checkpoint cannot reach the anchored head — refused dead on arrival, no
// judgment required. A continuation AFTER it is a visible tail the verifier
// anchors itself, by retention, the way the session record already teaches
// (I-2 one layer up). Between epochs, freshness is every Witness's own.
//
// Pure model, no I/O: rehearsal tooling writes it, the auditor verifies it,
// and every loop here verifies a ratified roll unchanged — ratification
// swaps documents, not code.

import { sha256Hex, signMessage, verifyMessage } from './keys.js';
import { canonicalBytes, canonicalJson, withoutField } from './canonical.js';
import { signSeal, verifySeal } from './seal.js';

/** The roll's event vocabulary — a closed set, like every vocabulary here. */
export const ROLL_ENTRY_KINDS = Object.freeze(['admission', 'rotation', 'revocation', 'accreditation']);

/** Who a roll row may bind (F-3's roles; the accreditation statute's classes). */
export const MEMBER_CLASSES = Object.freeze(['principal', 'long-lived-subject', 'external-witness']);

/** The seal subject an epoch checkpoint carries — the root's only verb over
 *  the roll is "the roll stood thus", and it says so in the subject line. */
export const CHECKPOINT_SUBJECT = 'roll-checkpoint';

/** Failure shape for roll refusals; reasons are stable codes the auditor cites. */
export class RollError extends Error {
  constructor(reason, message) {
    super(message);
    this.name = 'RollError';
    this.reason = reason;
  }
}

/** sha256 over the public half's bytes — the Member's coordinate everywhere. */
export const memberKeyDigestOf = (publicKeyBase64) => sha256Hex(Buffer.from(String(publicKeyBase64), 'utf8'));

/**
 * The genesis link, seeded from the roll's own genesis block (epoch length,
 * statute digest, declarations) — a roll presented over another genesis is
 * not the roll, and fails at its first link.
 */
export function rollGenesisHash(genesis) {
  return sha256Hex(`compact-roll-v1 ${canonicalJson(genesis)}`);
}

/** One link: the previous hash, the seq, and the event, hashed together —
 *  the session chain's own formula, verbatim. */
export function rollEntryHash(prevHash, seq, event) {
  return sha256Hex(`${prevHash} ${seq} ${canonicalJson(event)}`);
}

/** The head digest — what a checkpoint anchors and a verifier retains. */
export const rollHeadOf = (roll) => (roll.entries.length === 0
  ? rollGenesisHash(roll.genesis)
  : roll.entries[roll.entries.length - 1].entryHash);

/**
 * Sign an event with each given signer ({keyId, privateKey}; the private
 * half never leaves the caller). The signature covers the event's canonical
 * bytes — every field inside the signed bytes, so nothing a verifier checks
 * rides outside the signature.
 */
export function signRollEvent(event, signers) {
  const bytes = canonicalBytes(event);
  return signers.map(({ keyId, privateKey }) => ({ keyId, signature: signMessage(bytes, privateKey) }));
}

/**
 * Append one signed event to the roll, computing its chain coordinates
 * (seq, prev, entryHash). Form is checked; SEMANTICS are the verifier's —
 * this is the writer's half, and the auditor is the reader that refuses.
 */
export function appendRollEvent(roll, event) {
  if (!ROLL_ENTRY_KINDS.includes(event?.kind)) {
    throw new RollError('roll-malformed', `"${event?.kind}" is not a roll event kind (${ROLL_ENTRY_KINDS.join(', ')})`);
  }
  const seq = roll.entries.length;
  const prev = seq === 0 ? rollGenesisHash(roll.genesis) : roll.entries[seq - 1].entryHash;
  const { seq: _s, prev: _p, entryHash: _h, ...clean } = event;
  const row = { ...clean, seq, prev, entryHash: rollEntryHash(prev, seq, clean) };
  roll.entries.push(row);
  return row;
}

/** The instrument an epoch checkpoint seals: the roll's head digest, and
 *  nothing else — the root never signs a Member, an admission, or a seat. */
export const checkpointInstrument = (checkpoint) => {
  const { seal, ...instrument } = checkpoint;
  return instrument;
};

/**
 * Close an epoch: seal the roll's head digest k-of-n under the manifest and
 * record the checkpoint in the roll. Sub-threshold refuses — a broken
 * artifact is not emitted (the signSeal discipline).
 */
export function closeEpoch({ roll, epoch, manifest, privateKeys, now = new Date().toISOString() }) {
  const instrument = {
    kind: CHECKPOINT_SUBJECT, epoch,
    throughSeq: roll.entries.length - 1,
    rollHead: rollHeadOf(roll),
    at: now,
  };
  const seal = signSeal({
    bytes: canonicalBytes(instrument),
    subject: CHECKPOINT_SUBJECT,
    source: 'roll',
    manifest,
    privateKeys,
  });
  const checkpoint = { ...instrument, seal };
  roll.checkpoints.push(checkpoint);
  return checkpoint;
}

/**
 * The quorum check for authority signatures on a row: k DISTINCT valid
 * signers under the manifest (the review-0004 semantics, the same loop the
 * law seal runs). Returns the distinct signers counted.
 */
function countAuthorityQuorum(event, manifest, thresholdK) {
  const counted = new Set();
  for (const sig of event.signedBy ?? []) {
    const key = manifest.keys.find((k) => k.id === sig.keyId);
    if (!key) continue;
    if (counted.has(sig.keyId)) continue;
    if (verifyMessage(unsignedBytes(event), key.publicKey, sig.signature)) counted.add(sig.keyId);
  }
  return counted.size >= thresholdK ? counted : null;
}

/** The event half of a row: the row minus its chain coordinates. */
function eventOf(row) {
  const { seq: _s, prev: _p, entryHash: _h, ...event } = row;
  return event;
}

/** The bytes every event signature covers: the event WITHOUT its own
 *  signatures — the anchors' withoutField('signature') discipline, for a
 *  list. The CHAIN hash covers the event WITH them, so signatures are
 *  committed by the chain and cannot be stripped or swapped. */
const unsignedBytes = (event) => canonicalBytes(withoutField(event, 'signedBy'));

/**
 * Verify a roll, offline, naming every failure (I-7's discipline — the
 * auditor refuses in the same words). Checks, in order:
 *
 *   1. SHAPE — kind/class vocabularies, per-kind required fields, the
 *      digest/key consistency of every row that carries a public half.
 *   2. CHAIN — seq contiguity from 0, prev linkage, entryHash recomputed
 *      from the roll's own genesis (I-2's formula).
 *   3. SIGNATURES — per kind: admission/accreditation need the authority
 *      quorum AND the Member's own signature (possession, never assertion);
 *      rotation needs the PREDECESSOR's signature, the key resolved through
 *      the lineage the roll itself carries; revocation needs the quorum.
 *   4. SEMANTICS — digests enter the roll once; a rotation's predecessor
 *      must be the Member's LIVE current key (rotating a revoked key is the
 *      laundering path, and it refuses); a revocation names a Member that
 *      exists and is not already revoked.
 *   5. CHECKPOINTS — epoch instruments sealed k-of-n, cadence within the
 *      genesis epoch length, and the fork walk: the anchored rollHead must
 *      be reachable. A head before the offered tail names the unanchored
 *      remainder as the verifier's own retention; a head the roll cannot
 *      reach is a fork before the checkpoint — not the roll.
 *
 * @returns {{ok: boolean, findings: Array<{severity, rule, reason, detail}>,
 *   summary: object (anchoredThrough: number|null lives here, beside the counts),
 *   members: Array, byKey: Map}}
 */
export function verifyRoll({ roll, manifest, now = Date.now() }) {
  const findings = [];
  const bad = (severity, rule, reason, detail) => findings.push({ severity, rule, reason, detail });
  const at = (row) => `roll entry ${row?.seq} (${row?.kind})`;

  if (!(roll && Array.isArray(roll.entries) && Array.isArray(roll.checkpoints) && roll.genesis)) {
    throw new RollError('roll-malformed', 'a roll is { genesis, entries: [...], checkpoints: [...] } — the shape is the admission ticket');
  }
  const epochEvents = Number(roll.genesis?.epochLength?.events);
  if (!Number.isInteger(epochEvents) || epochEvents < 1) {
    bad('error', 'I-1', 'roll-malformed', 'genesis.epochLength.events must be a positive integer — the checkpoint cadence is a spending policy for the root\'s attention, fixed at genesis, never a runtime knob');
  }

  const k = manifest.threshold.k;
  const members = [];
  const byKey = new Map();        // key digest -> { member, publicKey }
  const digestSeen = new Set();   // every digest ever introduced

  let prev = rollGenesisHash(roll.genesis);
  roll.entries.forEach((row, index) => {
    // 1. SHAPE + 2. CHAIN — the record discipline first: a row that is not
    // where the chain says it is verifies nothing downstream
    if (row.seq !== index) bad('error', 'I-2', 'roll-seq', `${at(row)}: seq ${row.seq} at position ${index} — the roll is an ordered ledger, not a bag`);
    if (row.prev !== prev) bad('error', 'I-2', 'roll-link', `${at(row)}: prev ${String(row.prev).slice(0, 12)}… does not link the prior head ${prev.slice(0, 12)}… — the chain is broken here`);
    const event = eventOf(row);
    if (rollEntryHash(prev, index, event) !== row.entryHash) {
      bad('error', 'I-2', 'roll-hash', `${at(row)}: entryHash does not cover H(prev, seq, canonical(event)) — the row changed after chaining, or was never chained`);
    }
    prev = row.entryHash;

    if (!ROLL_ENTRY_KINDS.includes(row.kind)) {
      bad('error', 'I-1', 'roll-malformed', `${at(row)}: "${row.kind}" is not a roll event kind (${ROLL_ENTRY_KINDS.join(', ')})`);
      return;
    }
    if (!Array.isArray(row.signedBy) || row.signedBy.length === 0) {
      bad('error', 'I-1', 'roll-unsigned', `${at(row)}: carries no signatures — an identity event nobody signed is a mood, not a row`);
      return;
    }
    if (typeof row.memberKeyDigest !== 'string' || !row.memberKeyDigest) {
      bad('error', 'I-1', 'roll-malformed', `${at(row)}: no memberKeyDigest — the Member's coordinate is the one field no row omits`);
      return;
    }

    const authority = countAuthorityQuorum(event, manifest, k);
    const selfSig = (publicKey) => (row.signedBy ?? []).some((sig) => sig.keyId === row.memberKeyDigest
      && verifyMessage(unsignedBytes(event), publicKey, sig.signature));

    if (row.kind === 'admission' || row.kind === 'accreditation') {
      if (row.kind === 'accreditation' && row.class !== 'external-witness') {
        bad('error', 'F-8', 'roll-class', `${at(row)}: accreditation seats external Witnesses — class "${row.class}" is not "external-witness" (A-7)`);
      }
      if (row.kind === 'admission' && !MEMBER_CLASSES.includes(row.class)) {
        bad('error', 'F-8', 'roll-class', `${at(row)}: class "${row.class}" is not in the vocabulary (${MEMBER_CLASSES.join(', ')})`);
      }
      if (typeof row.memberKey !== 'string' || !row.memberKey) {
        bad('error', 'I-1', 'roll-malformed', `${at(row)}: a row binding a NEW key carries the public half — the digest alone cannot be verified against`);
        return;
      }
      if (memberKeyDigestOf(row.memberKey) !== row.memberKeyDigest) {
        bad('error', 'I-1', 'roll-key-mismatch', `${at(row)}: memberKeyDigest does not cover the carried memberKey — the coordinate and the key disagree`);
        return;
      }
      if (digestSeen.has(row.memberKeyDigest)) {
        bad('error', 'I-1', 'roll-digest-reused', `${at(row)}: binds ${row.memberKeyDigest.slice(0, 12)}… a second time — one key, one lineage, one Member; a re-binding is a new Member or a fraud`);
        return;
      }
      if (!authority) {
        bad('error', 'F-8', 'roll-sub-threshold', `${at(row)}: fewer than k=${k} distinct valid authority signatures — admission is statute-shaped, and the statute's quorum did not sign`);
        return;
      }
      if (!selfSig(row.memberKey)) {
        bad('error', 'I-1', 'roll-not-proven', `${at(row)}: no valid signature by the Member's OWN key — possession is proven by signing and never asserted by a third party`);
        return;
      }
      const member = { foundingDigest: row.memberKeyDigest, class: row.class, admittedAt: row.recordedAt, lineage: [row.memberKeyDigest], state: 'live' };
      members.push(member);
      byKey.set(row.memberKeyDigest, { member, publicKey: row.memberKey });
      digestSeen.add(row.memberKeyDigest);
      return;
    }

    if (row.kind === 'rotation') {
      const bound = byKey.get(row.predecessorKeyDigest);
      if (!bound) {
        bad('error', 'J-4', 'roll-unknown-predecessor', `${at(row)}: predecessor ${String(row.predecessorKeyDigest).slice(0, 12)}… is not a key this roll ever bound — rotation is an act of the Member being re-keyed, not of a stranger`);
        return;
      }
      if (bound.member.state !== 'live') {
        bad('error', 'J-4', 'roll-rotation-refused', `${at(row)}: rotates a Member whose standing is ${bound.member.state} — re-keying a revoked Member is the laundering path, and the roll is where it refuses`);
        return;
      }
      if (bound.member.lineage.at(-1) !== row.predecessorKeyDigest) {
        bad('error', 'J-4', 'roll-rotation-refused', `${at(row)}: predecessor is a SUPERSEDED key of its Member — only the current key rotates (the lineage is data, and this is what it is for)`);
        return;
      }
      if (row.class !== bound.member.class) {
        bad('error', 'J-4', 'roll-rotation-refused', `${at(row)}: rotation re-keys a Member, never re-classes one — "${row.class}" vs "${bound.member.class}" is a new Member or a fraud`);
        return;
      }
      if (typeof row.successorKey !== 'string' || memberKeyDigestOf(row.successorKey) !== row.memberKeyDigest) {
        bad('error', 'I-1', 'roll-key-mismatch', `${at(row)}: memberKeyDigest does not cover successorKey — the successor coordinate and the successor key disagree`);
        return;
      }
      if (digestSeen.has(row.memberKeyDigest)) {
        bad('error', 'I-1', 'roll-digest-reused', `${at(row)}: successor ${row.memberKeyDigest.slice(0, 12)}… is a digest the roll already bound — rotation outside the roll (a fresh admission for the same actor) is not rotation`);
        return;
      }
      const byPredecessor = (row.signedBy ?? []).some((sig) => sig.keyId === row.predecessorKeyDigest
        && verifyMessage(unsignedBytes(event), bound.publicKey, sig.signature));
      if (!byPredecessor) {
        bad('error', 'J-4', 'roll-rotation-refused', `${at(row)}: no valid signature by the PREDECESSOR key — the successor row is signed by the predecessor, or it is not a rotation`);
        return;
      }
      bound.member.lineage.push(row.memberKeyDigest);
      byKey.set(row.memberKeyDigest, { member: bound.member, publicKey: row.successorKey });
      digestSeen.add(row.memberKeyDigest);
      return;
    }

    if (row.kind === 'revocation') {
      const bound = byKey.get(row.memberKeyDigest);
      if (!bound) {
        bad('error', 'F-8', 'roll-unknown-member', `${at(row)}: revokes ${row.memberKeyDigest.slice(0, 12)}…, a key this roll never bound — revocation ends standing; it does not invent it`);
        return;
      }
      if (bound.member.state === 'revoked') {
        bad('error', 'F-8', 'roll-double-revocation', `${at(row)}: the Member is already revoked — a fact recorded twice is a malformed roll, not a stronger one`);
        return;
      }
      if (!authority) {
        bad('error', 'F-8', 'roll-sub-threshold', `${at(row)}: fewer than k=${k} distinct valid authority signatures — revocation is the statute's act, and the statute's quorum did not sign`);
        return;
      }
      bound.member.state = 'revoked';
      bound.member.revokedAt = row.recordedAt;
      bound.member.revocationRow = index;
    }
  });

  // 5. CHECKPOINTS — the anchoring walk
  let anchoredThrough = null;
  let expectedEpoch = 0;
  let lastThrough = -1;
  const headIndex = new Map(roll.entries.map((row, i) => [row.entryHash, i]));
  for (const cp of roll.checkpoints) {
    const instrument = checkpointInstrument(cp);
    if (instrument.kind !== CHECKPOINT_SUBJECT || !Number.isInteger(cp.epoch) || !Number.isInteger(cp.throughSeq)
      || typeof cp.rollHead !== 'string' || typeof cp.at !== 'string') {
      bad('error', 'I-1', 'checkpoint-malformed', `checkpoint epoch ${String(cp.epoch)}: an epoch instrument is { kind: 'roll-checkpoint', epoch, throughSeq, rollHead, at, seal }`);
      continue;
    }
    if (cp.epoch !== expectedEpoch) {
      bad('error', 'I-1', 'checkpoint-cadence', `checkpoint epoch ${cp.epoch}: epochs run consecutively from 0 — expected ${expectedEpoch}`);
      expectedEpoch = cp.epoch + 1;
      continue;
    }
    expectedEpoch += 1;
    if (cp.throughSeq <= lastThrough) {
      bad('error', 'I-1', 'checkpoint-cadence', `checkpoint epoch ${cp.epoch}: throughSeq ${cp.throughSeq} does not advance past ${lastThrough} — checkpoints seal a moving head, in order`);
      continue;
    }
    if (Number.isInteger(epochEvents) && cp.throughSeq - lastThrough > epochEvents) {
      bad('error', 'I-1', 'checkpoint-cadence', `checkpoint epoch ${cp.epoch}: ${cp.throughSeq - lastThrough} events since the last epoch exceed the genesis cadence of ${epochEvents} — the cadence is a spending policy fixed at genesis, not a mood`);
    }
    lastThrough = cp.throughSeq;
    try {
      verifySeal({ bytes: canonicalBytes(instrument), subject: CHECKPOINT_SUBJECT, seal: cp.seal, manifest });
    } catch (e) {
      bad('error', 'I-1', 'checkpoint-unverified', `checkpoint epoch ${cp.epoch} refused: ${e.message}`);
      continue;
    }
    const reached = headIndex.get(cp.rollHead);
    if (reached === undefined) {
      bad('error', 'I-1', 'checkpoint-fork', `checkpoint epoch ${cp.epoch}: the offered lineage never reaches the anchored head ${cp.rollHead.slice(0, 12)}… — a fork before the checkpoint is not the roll, refused dead on arrival (no judgment required)`);
      continue;
    }
    if (reached !== cp.throughSeq) {
      bad('error', 'I-1', 'checkpoint-mismatch', `checkpoint epoch ${cp.epoch}: declares throughSeq ${cp.throughSeq} but its rollHead sits at seq ${reached} — the instrument and the ledger disagree`);
      continue;
    }
    anchoredThrough = cp.throughSeq;
  }
  const lastSeq = roll.entries.length - 1;
  if (anchoredThrough !== null && anchoredThrough < lastSeq) {
    bad('warning', 'I-2', 'checkpoint-tail', `${lastSeq - anchoredThrough} entr(ies) past the last anchored head: integrity rides the chain, and freshness is this verifier's own retention — retain the head you saw (I-2, one layer up)`);
  }

  const live = members.filter((m) => m.state === 'live').length;
  const supersededKeys = [...byKey.keys()].filter((d) => {
    const m = byKey.get(d).member;
    return m.lineage.at(-1) !== d;
  }).length;
  return {
    ok: !findings.some((f) => f.severity === 'error'),
    findings,
    summary: {
      entries: roll.entries.length,
      members: members.length,
      live,
      revoked: members.filter((m) => m.state === 'revoked').length,
      rotations: roll.entries.filter((r) => r.kind === 'rotation').length,
      keys: byKey.size,
      supersededKeys,
      checkpoints: roll.checkpoints.length,
      anchoredThrough,
      basis: 'dev-keyring',
      conveysStanding: false,
    },
    members,
    byKey,
  };
}

/**
 * Resolve a public key (or its digest) to the Member it belongs to, through
 * the VERIFIED roll's own lineage — the J-4/F-6 seam: pre- and
 * post-rotation keys resolve to one Member, and a revoked key says so.
 * @returns {{state, class, lineage, foundingDigest}|null}
 */
export function resolveMember(verified, keyOrDigest) {
  const asString = String(keyOrDigest);
  const digest = /^[0-9a-f]{64}$/.test(asString) ? asString : memberKeyDigestOf(asString);
  const bound = verified.byKey.get(digest);
  if (!bound) return null;
  const { member } = bound;
  const state = member.state === 'revoked' ? 'revoked' : (member.lineage.at(-1) === digest ? 'live' : 'superseded');
  return {
    state, class: member.class, lineage: [...member.lineage], foundingDigest: member.foundingDigest,
    ...(member.state === 'revoked' ? { revocationRow: member.revocationRow ?? null } : {}),
  };
}
