# Concept — supply-chain honesty (CF-2)

*The implementation-agnostic spec `packages/sandbox-docker/src/provenance.js`
cites. Phase 6 (re-scoped — see [the decision record](decision-phase6-scope.md)).*

## The clause

> **CF-2 · [M within CF] · Supply-chain honesty.** Reused execution
> environments carry their acquisition history; what a confinement needed to
> build may demand no more at run time than was lawfully approved at build
> time, and any excess is a new gate, not an inheritance.

## The live subject is the image, not a layer store

The port plan imagined this clause being satisfied by a content-addressed
artifact store with layer capture. It is satisfied much closer to home: a
**docker image is a reused execution environment**. It was built somewhere,
with some network access, and a composition that binds it with no acquisition
history is in breach with one config field.

No layer store is required to be in breach, and none is required to leave it.

## Three duties

### 1. Acquisition history travels with the environment

Every image the provider may run must have a declared provenance record. An
undeclared image has no history and cannot be reasoned about, so it fails
closed — at boot, where refusing is still cheap, and again at confine time.

### 2. Identity is content, not a name

A record is keyed by the image **digest**, and the digest is re-resolved from
the daemon at confine time. Acquisition history attributed to a mutable tag is
not history: the tag can name different content tomorrow, and the record would
silently describe something that is no longer there. A tag that has drifted off
its record refuses the confinement.

This is the only place this composition needs content addressing — and it needs
no store to get it.

### 3. Build approval is never a run-time entitlement

`buildApprovals` is recorded, surfaced, and auditable — and is **never an input
to any run-time permit decision**. The check never consults it to allow
anything. A run-time demand is answered only by a live run-time grant, freshly
gated through the Phase 1 layers.

That is the literal reading of *"any excess is a new gate, not an
inheritance"*, and it is testable as an absence: an image built with approval
for `registry.npmjs.org` gets exactly the same refusal as one built with no
approvals at all.

## The code itself (CF-2 applied to the code)

### The precise version

**In one breath:** the image was named by content; the code was named by
a commit. A commit names a tree — not the code that loaded, when a
package resolves elsewhere or a byte changed. The community launcher now
digests the code that loads, by content, and the hash chain carries it.

- **What is digested, at boot** (`tools/code-digest.mjs`): every
  workspace package, file by file, as git hashes files (blob ids), from
  where it actually resolves; the lockfile; the installed `node_modules`
  tree. One top-level digest covers the detail.
- **Where it lands:** the self-model's attestation carries the top digest
  — as a `Code:` line the Subject reads and as `source.code` on the
  injected event — so every session's chain holds it. The detail rides the
  manifest (`code.digests`) and the state dir (`code-digest.json`), and is
  trusted only because it hashes to the chained digest.
- **How it is checked:** `node auditor/audit.mjs <log> --code <run.json>
  --repo <checkout>` recomputes each package's digest from the commit's own
  tree (`git ls-tree`, no checkout) and the lockfile from the commit; a
  mismatch is a `CF-2` finding naming the package. The installed tree is not
  in git: it is reported, comparable across runs, never "verified".
- **What it is not:** a seal. The digest is computed by the process it
  describes; a host that lies can lie here. It turns "the record says
  commit X" into "the record says these exact bytes, checkable against
  commit X" — evidence, not prevention. Signatures wait on keys (I-1).

### The plain version

- **Before:** a run recorded which version of the code it used, by name.
  If the code on disk differed from that version — a stray edit, or the
  wrong copy loaded — nothing could tell afterwards.
- **After:** the run records a fingerprint of the code's actual contents
  in its tamper-evident record, and anyone with the repository can check,
  offline, that the fingerprint matches the version the run names:
  ```bash
  node auditor/audit.mjs <session.v4.jsonl> --code run.json --repo .
  # "code": "verified against the commit" — or a CF-2 finding per package that is not the commit's
  ```
- **Where this stops:** the fingerprint is taken by the run itself, so it
  proves consistency, not honesty; and third-party code can be compared
  between runs, not against the repository.

## The attestation basis is itself declared

| Basis | Meaning |
|---|---|
| `build-recorded` | this composition recorded the build and its gates |
| `operator-declared` | a human asserted the history; nothing verified it |

An `operator-declared` record produces a **declared gap** in the boot record
(I-8). The weaker basis is never silently equated with the stronger one —
saying which one you have is the difference between a convention and a fraud.

## Refusals

| Rule ID | When |
|---|---|
| `CF-2/undeclared-image` | the image carries no acquisition history |
| `CF-2/unresolvable-digest` | the daemon cannot say what the tag resolves to |
| `CF-2/digest-drift` | the tag now names different content than the record describes |
| `CF-2/uninherited-network` | an open network posture with no live run-time grant |

Each carries the Compact envelope: the rule that caused it and the lawful next
moves (R-3/I-4).
