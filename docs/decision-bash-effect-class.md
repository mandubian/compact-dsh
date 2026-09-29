# Decision record — the bash effect-class half of consent identity (#26): the exec-cache conflation, adjudicated

**Status: ADOPTED — option A and option B (2026-09-25, Principal).** A
landed as the command-scoped fingerprint for target-less calls; **B landed on
top of it as the bash effect class** — the closed read-only vocabulary, the
split/max/poison compound semantics, and the null-class fallback to A's
payload (target-ful included, which is what closes the live compound rider);
the granularity was tightened on adoption review to command-scoped-everywhere
(no class+verb identity — the Principal's call, recorded below). **Option C
stands as the stopgap any operator can reach for today.** Drafted 2026-09-24
against
[#26](https://github.com/mandubian/compact-dsh/issues/26), which the egress
record deferred here ("#26's bash effect-class half, which keeps its own
record and adjudication"). Constitutional under A-4 (recorded before the
work); nothing here changes a fingerprint, a grant, or an envelope until
adopted. The principle is not re-argued — it is
[decision-consent-identity.md](decision-consent-identity.md) position 1:
**consent identity is risk identity**.

## Where the record already stands

The network half of #26 is landed and enforced: the method class joins the
fingerprint when the caller declares it (`fingerprint.js` — "approving a read
never covers the state-changing act to the same target"), the ask carries the
class, the materialized egress grant is classed, the mediator re-checks it per
connection, and the egress grant vectors pin the worked examples — GET and
POST to one target are different fingerprints, and an undeclared class
preserves the pre-existing payload (`egress-grants.test.js`).
[#24](https://github.com/mandubian/compact-dsh/issues/24) is closed: an
allowed-once answer now materializes its exec-cache entry. Both facts move
this record's subject from design to **live enforcement surface** — which is
why the bash half can no longer wait as a footnote.

## The finding — the conflation is live, not hypothetical

The issue's second conflation is the default posture on main today:

- `evaluate.js` layers begin at `fingerprint(tool, args)`; the payload is
  `{tool, ...canonicalTarget(args)}` — and `canonicalTarget` extracts only
  `host`/`port`/`url`. A bash call's args are `{command}`; they contribute
  nothing. **Every bash command hashes to the same fingerprint**,
  `fp_… = hash('{"tool":"bash"}')` — `ls /` and `rm -rf <workspace>` are the
  same identity, exactly as #26 filed.
- The ask flow approves under that identity and materializes the cache entry
  under it (`index.js`: `cacheSet(rec.fp, …, canonicalTarget(rec.args))`).
- The cache TTL default is **24 hours** (`DEFAULTS.execCacheTtlMs`), and no
  composition layer overrides it.

So one bash approval admits **every network-less bash command for 24 hours,
unasked** — `ls /` approved, `rm -rf <workspace>` replays — and any bash
approval, even of a network-bearing command, materializes the same
constant-fingerprint entry as a passenger. #26's caveat "once #24 lands the
generalization becomes live" has overtaken itself: #24 landed as the fix that
materializes the cache, and the conflation became live in the same slice.
Confinement bounds the blast radius to the workspace — but the workspace is
the operator's project, and #26 already said what that means: fatal within
the walls is still fatal.

**Precision: which gate, which fingerprint.** A bash call with a network
finding runs two gate evaluations. The remote-access plugin routes each
finding through the grant layers with synthetic arguments —
`{...target, methodClass, delivery}` — whose fingerprints ARE target-scoped:
the network half working exactly as adopted. The approval gate's own listener
then evaluates the base call with the call's real arguments — `{command}` —
under the constant fingerprint. The conflation therefore lives in the base
gate, and it collapses precisely the network-less family (`ls`, `cat`,
`git status`, `rm -rf` — the issue's cases). The network half is not
defeated; an ungated layer runs beneath it.

The masking is also visible in the record: the replay receipt reads
`Replay: "bash" [fp_…]` with no target — an entry that names nothing cannot
tell the operator what a prior approval is currently paying for.

**The precedent the record already holds.** The gate's secret-reference code
path — `commandAwareFingerprint` in `packages/approval/src/index.js` (the
targetless call that names a declared secret) — refuses this conflation by
construction: it hashes the command text, under the doctrine "allow-once
covers exactly this command, never a blanket over the tool." The mechanism
exists; it is applied to that one path only. The adjudication below is over
how far to generalize it.

## The options

**Option A — command-scoped identity for bash (generalize the secret
branch's precedent).** The bash payload gains the command text (the exact
function the secret branch already runs). Replay narrows to the **identical
re-run** — `ls /` asks, `ls /` replays, `ls /b` asks, `rm -rf` asks. Nothing
is classified, nothing guessed (D-7-clean: no abstraction without a fact
behind it), and the overclaim dies entirely. Cost: no phrasing abstraction
for bash — the cache's replay value shrinks to exact re-runs (still real:
retries and deterministic re-execution), and every distinct command asks once
per TTL. Normalization stays out by the record's own rule — whitespace or
path spelling variants are new asks, because normalization is abstraction,
and abstraction by editing is guessing wearing a suit.

**Option B — static effect classes join the identity (the issue's direction
1).** The analyzer gains a bash classifier as the one authority: a curated
read-only vocabulary (`ls`, `cat`, `pwd`, `git status|log|diff`, …) → class
`read`; everything else — mutating, or statically unresolvable (pipes,
subshells, variable expansion) — → `null`, and the null class falls back to
A's command-scoped payload (D-7: absent class, no cross-command identity —
the exact shape the egress family already runs for a classless network
target). What B must adjudicate **before** it lands, because it is the same
trap one level down: the granularity of a read identity. Class-only collapses
`cat .env` into an approved `ls /` (overclaim inside the class — the defect
re-enters through the vocabulary); class+verb matches the issue's worked pins
(`ls`→`ls` replays, `ls`→`cat` asks); anything finer is A with extra steps.
Cost either way: the vocabulary becomes a security-critical surface — one
verb mis-filed as read-only re-opens the hole with a stamp on it — and the
golden vectors, verdicts, and ask wording all gain the axis.

**Decided, as implemented (2026-09-25; granularity TIGHTENED the same day
on the Principal's review).** The effect axis exists as the **null-class
fallback only**: an unprovable command is command-scoped, target-ful
included — the compound rider closes — while a provable read keeps the
payload it already had and a target-less call is command-scoped **regardless
of class**. No class+verb identity: for a local read the risk axis is the
ARGUMENTS — which files the act touches — so `ls /tmp` and `ls /etc` are
different acts and one approval never covers the other; `cat .env` approved
never replays `cat /etc/shadow`. This is the G5 doctrine at the bash layer
(approving `?page=1` never covers `?page=2`), and it keeps the one-behavior
contract literal: the cache replays only what the analyzer can prove is the
SAME act, and a re-phrased read is not the same act. The residual that
remains: a provable-read rider on a target-ful compound shares the target's
identity (`curl x && echo hi` replays as `curl x`) — bounded by the
vocabulary's conservatism — and the vocabulary, not the fingerprint, is
where suspicion belongs. **The vocabulary as landed**
(starting minimal, growing only by adjudication): `ls pwd cat head tail echo
printf wc which whoami id groups date uname uptime hostname df du ps stat env
printenv grep sort uniq basename dirname true false test`; `git` only for
status/log/diff/show/branch/tag/rev-parse/remote/describe/ls-files/blame;
`curl` only when it writes nowhere locally (`-o -O --output -T --upload-file
--stderr -J` poison); **never** wget (saves its body by default), never the
package managers (they write their stores), never anything with a redirect or
an expansion mark. Every unprovable command — including all of non-bash — is
command-scoped by the fallback.

**Option C — the configuration floor: disable the bash exec cache.** Set
`execCacheTtlMs: 0` — available to any composition **today**, no code. Every
bash command asks; replay dies for the whole cache (network acts included),
which is the price of reaching for a global switch to fix a bash-shaped
hole. A per-family exclusion (no cache for commands with no network finding)
is the same posture with less collateral, at the cost of one seam.

| | overclaim surface | replay usefulness | machinery | availability |
|---|---|---|---|---|
| **A** command-scoped | none beyond the exact re-run | identical re-runs only | one seam, already exists in the secret branch | land now |
| **B** effect classes | the granularity question, drafted above | read-shape replays | classifier + vocabulary + vectors | after its own adoption slice |
| **C** config floor | none | none (global) / none for bash (per-family) | none | today, composition-side |

**The decision (2026-09-25)**: A now — adopted as the command-scoped
fingerprint for target-less calls — and **B commissioned as the upgrade on
top of it** (A's payload **is** B's null-class fallback, so B adopts on top
of A rather than instead of it); C remains the stopgap any operator can reach
for today. A's scope is the latent half (stated above): the live compound
rider is B's to close. And A is the branch the
record's own doctrine already runs where it knew identity mattered; the
finding above is that the same doctrine applies to every bash command, not
only the ones that name a secret. Until one of the three is adopted, the
honest interim posture is C's: a composition that runs the default 24h cache
is running the conflation knowingly. The decision is the Principal's.

## What adoption would touch

1. `fingerprint.js` — the bash payload (option A: the command text; option B:
   the class axis with A as fallback). `evaluate.js` untouched — the layers
   read the fingerprint, they do not care what is in it.
2. Golden vectors gain the bash pins: identical command replays; different
   command asks; the secret branch's command-aware identity unchanged.
3. The replay receipt is left as it is: the fingerprint it already quotes
   becomes command-distinctive under A, and command text itself must not
   enter the notes (the secret-path pin holds — the receipt names the
   identity, never the command).
4. Register evidence moves with the adopting `[baseline-update]` (A-4), with
   I-5/R-3 conduct refinement per #26's direction 4 — no clause re-grading.

## Non-goals

- No re-litigation of the principle — position 1 is adopted record.
- No classifier vocabulary here — if B is the direction, its vocabulary is
  its own adjudication with its own golden vectors, not an appendix.
- No change to the network half — it is landed, enforced, and pinned.
