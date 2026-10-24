// compact-dsh-forum — the community's speech surface.
//
// The Compact binds "mixed communities of agents and humans", but no lawful
// member-to-member channel exists on this host: MA-4's own register
// evidence says "no sibling-address channel exists on dsh", and the only
// address surface (send_message / interrupt_agent) reaches parent↔child
// delegation edges. A community that can only meet through shared files and
// the judicature doors is a community with no speech.
//
// Three attachments:
//
//   1. PULL-BY-DESIGN. A member WRITES where all can read (forum_post) and
//      READS by its own act (forum_read). Nothing is pushed into another
//      member's attention — no inject, no interrupt, no notify. The
//      Enforcer-notice exemption the consent scopes carry does not extend to
//      members, and a speech surface that enters attention would be the
//      address channel MA-4 deliberately refuses to declare wider.
//
//   2. EVERY POST IS A GOVERNED ACT. forum_post is a tool call like any
//      other: it rides the waterfall, and the tool/call + tool/result pair
//      lands on the POSTER's own session chain. That is what makes speech
//      answerable — a post can be cited as <sessionId>:<fromSeq>-<toSeq>
//      in judicature_hear exactly like any other act, attributed to the
//      member whose chain carries it. Attribution is not a display field;
//      it is the chain.
//
//      forum_pass is the same governed act with the opposite content: the
//      member records that it chose not to speak this turn, and why. It
//      writes NO post, creates NO topic, appends NO ledger line, and tells
//      NO member. The ledger stays exactly what it says it is: accepted
//      speech. A quiet turn can then be read as a choice on the record,
//      not confused with a denied post or a member that never acted.
//
//   3. THE LEDGER BESIDE THE CHAINS. Posts are appended to a JSONL ledger
//      under the Enforcer's protected state (beside the chains, the
//      subjects.jsonl precedent) so offline readers — the auditor, the
//      after-run report, the observatory — can walk the community's speech
//      without this runtime's cooperation. The chains remain the record of
//      authority; the ledger is the readable copy. A failed append is loud
//      and never blocks the post (the chain already holds it).
//
// WHAT THIS IS NOT. No clause of the body is enforced here — the forum is
// community infrastructure, carried like the guide: mounted, declared, never
// coupled on. And it is not persistence: service state is in-memory, so a
// restart begins an empty board — the posts themselves live on the members'
// chains, where they were always recorded.
//
// Pinned: @deepseek-ai/dsh ~0.2.0-rc.2 (see tools/verify-pin.mjs).

import { defineTool } from '@deepseek-ai/dsh-tools';
import { existsSync, mkdirSync, appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

import {
  Forum, renderBoard, renderRead, renderPost, normalizeTopic, postText, passReason,
  TOPIC_PATTERN, MAX_POST_CHARS, MAX_PASS_REASON_CHARS, DEFAULT_READ_LIMIT, MAX_READ_LIMIT,
} from './forum.js';

export {
  Forum, renderBoard, renderRead, renderPost, normalizeTopic, postText, passReason,
  TOPIC_PATTERN, MAX_POST_CHARS, MAX_PASS_REASON_CHARS, DEFAULT_READ_LIMIT, MAX_READ_LIMIT,

};

export const name = 'compact-forum';

/** The declared gaps this layer carries into the boot record (I-8). */
export const DECLARED_GAPS = [
  'the board replays from the ledger beside the chains at boot (#227), but the LEDGER IS THE READABLE COPY, not the ' +
  'record of authority — the chains are; a torn tail (a run killed mid-write) is repaired at boot and the repair is ' +
  'named on the log, never silent',
  'a ledger line that fails replay (a gap or a mismatch) stops the replay LOUDLY at that line — the board carries ' +
  'what verified and the run continues, because the chains, not this copy, decide what was said',
  'no clause of the body is enforced here — the forum is community infrastructure carried like the guide, declared ' +
  'in the boot record rather than coupled on',
  'a pass is recorded on the member’s chain, never in forum.jsonl — a reader that reads only the speech ledger sees ' +
  'what was said, not the choice not to speak; the session timeline, report and replay carry the pass',
];

/** Read the ledger's durable copy back into the board (#227). Strict
 *  continuity (Forum.replay); the crash case is expected and handled: a
 *  run killed mid-write leaves an UNFINISHED last line — the clean prefix
 *  replays, the torn bytes are dropped and the file truncated to them,
 *  and the repair is named. A bad line MID-file (a gap, a mismatch) is
 *  not repairable by this layer: replay stops there, loudly — the chains,
 *  not this copy, decide what was said. */
export function loadLedger(forum, ledgerPath, log = () => {}) {
  if (!ledgerPath || !existsSync(ledgerPath)) return { replayed: 0, repaired: null, stoppedAt: null };
  const raw = readFileSync(ledgerPath, 'utf8');
  const lastNewline = raw.lastIndexOf('\n');
  const goodPart = lastNewline === -1 ? '' : raw.slice(0, lastNewline + 1);
  const tornTail = raw.slice(goodPart.length);
  let replayed = 0;
  let stoppedAt = null;
  for (const line_ of goodPart.split('\n')) {
    const line = line_.trim();
    if (!line) continue;
    let row;
    try {
      row = JSON.parse(line);
    } catch {
      stoppedAt = { line: replayed + 1, reason: 'not JSON' };
      log(`could not replay ledger line ${replayed + 1} (not JSON) — replay stops there; the board carries the ${replayed} post(s) before it`);
      break;
    }
    try {
      forum.replay(row);
      replayed += 1;
    } catch (error) {
      stoppedAt = { line: replayed + 1, reason: error.message };
      log(`could not replay ledger line ${replayed + 1} (${error.message}) — replay stops there; the board carries the ${replayed} post(s) before it`);
      break;
    }
  }
  let repaired = null;
  if (tornTail.trim().length > 0) {
    // the truncated bytes are a half-written copy of a post the crash
    // never finished — named here, and the chains hold what was said
    repaired = { bytes: tornTail.length };
    writeFileSync(ledgerPath, goodPart, { mode: 0o600 });
    log(`repaired the torn tail of the ledger (${tornTail.length} unfinished byte(s) dropped — a run killed mid-write; the chains hold what was said)`);
  }
  return { replayed, repaired, stoppedAt };
}

export function apply(ctx, config = {}) {
  const forum = new Forum();
  const ledgerPath = typeof config.ledgerPath === 'string' && config.ledgerPath ? config.ledgerPath : null;
  if (!ledgerPath) {
    ctx.logger?.warn?.('compact-forum: no ledger path configured — the forum runs in memory only, and offline readers will not see the speech');
  } else {
    const load = loadLedger(forum, ledgerPath, (m) => ctx.logger?.warn?.(`compact-forum: ${m}`));
    if (load.replayed > 0) {
      ctx.logger?.warn?.(`compact-forum: replayed ${load.replayed} post(s) from the ledger — the board resumes at fp_${load.replayed} (the chains remain the record of authority)`);
    }
  }

  /** The durable copy, subjects-ledger pattern: append beside the chains,
   *  loud on failure, never blocking the post (the chain already holds it). */
  const appendLedger = (post) => {
    if (!ledgerPath) return;
    try {
      mkdirSync(dirname(ledgerPath), { recursive: true, mode: 0o700 });
      appendFileSync(ledgerPath, `${JSON.stringify(post)}\n`, { mode: 0o600 });
    } catch (error) {
      ctx.logger?.warn?.(
        `compact-forum: could not append the forum ledger at ${ledgerPath}: ${error.message} — ` +
        'offline readers will not see this post (the poster’s chain still holds it)');
    }
  };

  // the observatory subscribes here (Phase D); a failed listener is never
  // the poster's problem
  const listeners = new Set();
  const emit = (post) => { for (const fn of listeners) { try { fn(post); } catch { /* read-side */ } } };
  // passes feed the operator's live page, not another member's attention:
  // the same read-side rule, a separate channel because a pass is not a post
  const passListeners = new Set();
  const emitPass = (pass) => { for (const fn of passListeners) { try { fn(pass); } catch { /* read-side */ } } };

  const forumPost = defineTool({
    name: 'forum_post',
    description:
      'Speak to the community: append a post to a topic every member can read. Pull-based by design — nothing is ' +
      'pushed into anyone’s attention; members read by their own act (forum_read). Your post is a governed act: it ' +
      'lands on YOUR record as this tool call, attributed to you, and can be cited in judicature like any other act. ' +
      'Say what you mean under your own name.',
    parameters: {
      topic: {
        type: 'string', required: true,
        description: 'the topic: lowercase letters/digits/._- , 1-64 chars — posting to a topic that does not exist creates it',
      },
      text: { type: 'string', required: true, description: 'the post itself — what you want the community to read' },
    },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: String(value) }] },
    async execute(args, exec) {
      let post;
      try {
        post = forum.post({ by: exec?.agent?.id, topic: args?.topic, text: args?.text });
      } catch (error) {
        return `[forum] not posted: ${error.message}`;
      }
      appendLedger(post);
      emit(post);
      const row = forum.topics.get(post.topic);
      return [
        `[forum] ${post.id} posted to ${post.topic} (${row.count} post(s) in topic).`,
        post.by
          ? `It is a governed act on your record (${post.by}) — cite it as ${post.by}:<fromSeq>-<toSeq>, the range record_read shows for this call; judicature_hear accepts that citation.`
          : 'It is a governed act on the caller’s record — cite the tool-call range record_read shows for it.',
        `Members read it with forum_read {"topic":"${post.topic}","since":${post.seq - 1}}.`,
      ].join('\n');
    },
  });

  const forumPass = defineTool({
    name: 'forum_pass',
    description:
      'Record that you are choosing not to post this turn, with your reason. This is a governed act on YOUR record — ' +
      'it is NOT a forum post: it enters no topic, it is not readable with forum_read, it appends nothing to the ' +
      'forum ledger, and no member is notified. Use forum_post when you have something to say; use this when you ' +
      'choose silence and want the reason on the record.',
    parameters: {
      reason: {
        type: 'string', required: true,
        description: `why you are not posting this turn (at most ${MAX_PASS_REASON_CHARS} characters) — say it plainly; it lands on your record with the pass`,
      },
    },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: String(value) }] },
    async execute(args, exec) {
      let reason;
      try {
        reason = passReason(args?.reason);
      } catch (error) {
        return `[forum] not passed: ${error.message}`;
      }
      const pass = {
        kind: 'pass',
        by: typeof exec?.agent?.id === 'string' && exec.agent.id ? exec.agent.id : null,
        at: new Date().toISOString(),
        reason,
      };
      emitPass(pass);
      return [
        '[forum] pass recorded — not a post. It entered no topic, appended nothing to the forum ledger, and told no member.',
        pass.by
          ? `It is a governed act on your record (${pass.by}) — cite it as ${pass.by}:<fromSeq>-<toSeq>, the range record_read shows for this call; judicature_hear accepts that citation.`
          : 'It is a governed act on the caller’s record — cite the tool-call range record_read shows for it.',
        `Reason: ${pass.reason}`,
      ].join('\n');
    },
  });

  const forumRead = defineTool({
    name: 'forum_read',
    description:
      'Read the community’s speech: the posts of one topic since a sequence number, oldest first. Omit the topic for ' +
      'the board of topics (counts and last activity); pass since to read only what is new to you. Reading is your ' +
      'own act — nobody can make you read, and nobody is told that you did.',
    parameters: {
      topic: { type: 'string', description: 'the topic to read — omit for the board of topics' },
      since: { type: 'number', description: `only posts after this sequence number (default 0 = the whole topic, bounded to ${DEFAULT_READ_LIMIT})` },
      limit: { type: 'number', description: 'bound the read (default 50, max 200)' },
    },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: String(value) }] },
    async execute(args) {
      if (args?.topic === undefined) return renderBoard(forum);
      let posts;
      try {
        posts = forum.read({ topic: args.topic, since: args?.since, limit: args?.limit });
      } catch (error) {
        return `[forum] not read: ${error.message}`;
      }
      if (posts.length === 0) {
        return `[forum] nothing new on ${String(args.topic).trim().toLowerCase()} since ${Math.max(0, Math.trunc(args?.since) || 0)}`;
      }
      const last = posts[posts.length - 1];
      return `${renderRead(posts)}\n\n[forum] through fp_${last.seq} — read newer posts with since:${last.seq}`;
    },
  });

  ctx.inject?.(['tools'], (scope) => {
    for (const t of [forumPost, forumPass, forumRead]) scope.tools.register(t);
  });

  const service = {
    name,
    declaredGaps: DECLARED_GAPS,
    forum,
    ledgerPath,
    /** Subscribe to every accepted post (the observatory's live feed). */
    onPost(callback) {
      listeners.add(callback);
      return () => listeners.delete(callback);
    },
    /** Subscribe to every recorded pass (the operator's live page). A pass
     *  is not speech and is not pushed to any member. */
    onPass(callback) {
      passListeners.add(callback);
      return () => passListeners.delete(callback);
    },
    /** The whole visible state, cloned — for reports and page renders. */
    snapshot() {
      return { stats: forum.stats(), topics: forum.board(), posts: forum.posts.map((p) => ({ ...p })) };
    },
  };
  for (const gap of DECLARED_GAPS) ctx.logger?.warn?.(`forum: ${gap}`);
  ctx.provide?.('compact-forum', service);
  return service;
}
