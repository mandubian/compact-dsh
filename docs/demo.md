# Demonstrations — what the Compact adds, visibly

Each demo below is runnable and ends in something you can *see*: a refusal
that names its rule, a record that catches a rewrite, a boot that refuses to
lie. Wherever possible the "what plain dsh does instead" contrast is stated,
because the value is the difference.

All demo state lives under `~/.compact-dsh` by default; the live demos use
the launcher, which isolates `DSH_HOME` and never touches a normal dsh
profile. Every claim marked **(verified)** was captured from an actual run.

## Prerequisites

```bash
node --version          # >= 22.19
npm ci                  # reproduces the tested host dependency set
docker pull ubuntu:24.04
```

The launcher resolves the sandbox image digest from the **local** Docker
daemon (`.Id` via `docker image inspect`) and never pulls implicitly. Live
model demos additionally need `DEEPSEEK_API_KEY` **or** an OpenCode Zen /
OpenRouter route configured in `~/.compact-dsh/settings.yaml` (see the README
section "Try Compact inside dsh").

Sanity check — boots the real dsh loader, the full enforcement composition,
and the constitution coupling, with **no model request**:

```bash
npm run compact:smoke
```

Expected **(verified)**:

```
compact-dsh: ready (smoke; no LLM request); draft Compact, no Compact standing.
State: /home/you/.compact-dsh; records: …/sessions; chains: …/chains; approvals: …/approvals.json
```

The second sentence is the honesty rule F-5 made load-bearing: the
composition attests at boot that it claims **no standing** because the law it
enforces is an unratified draft.

---

## Demo 1 — History you can prove (I-2 / R-7) · offline, no key

Run any live task once (Demo 2 below works), then:

```bash
D=~/.compact-dsh/sessions/--home-…--/session-<id>
C=~/.compact-dsh/chains/session-<id>.chain

# 1. the record attests
node auditor/audit.mjs "$D/session.v3.jsonl" --chain "$C" --quiet
# (verified) auditor: conforming (21 events, 0 approval asks)   — exit 0

# 2. rewrite one recorded fact on a COPY — flip the permission preset
cp "$D/session.v3.jsonl" /tmp/tampered.jsonl
sed -i '0,/"preset":"workspace-write"/s//"preset":"danger-full-access"/' /tmp/tampered.jsonl

# 3. the offline auditor catches it, without the Enforcer's cooperation
node auditor/audit.mjs /tmp/tampered.jsonl --chain "$C" --quiet
```

Expected **(verified)**:

```
0 chain [I-2] broken-link: record: the session log for session-… is not evidence
at seq 0 — the stored event does not hash to its committed link (expected
811073a6…, computed 6aa089f7…) — it was altered after it was recorded. …
auditor: 1 violation(s) — the session does not conform        — exit 1
```

**Contrast.** A plain dsh session log is plain JSONL — the same `sed` is
undetectable by anyone, forever. Here, anyone who kept the chain head (one
64-hex string) can prove which events were rewritten, offline, years later.
An act that cannot be retroactively edited is what makes "recorded" mean
anything (R-7: non-repudiation without a tamper-evident record is a promise,
not a right).

Note the attack surface this closes: the most motivated forger of an agent
session is the operator itself. This demo shows even *that* rewrite fails.

---

## Demo 2 — A refusal that teaches (R-3 / I-5 / D-7) · live, needs a key

```bash
npm run compact -- "Run: git push origin main"
```

`git push` is a network verb with **no statically resolvable target** (which
remote? which host?). The remote-access analyzer refuses it *before
execution* with an envelope:

```
[RA/D-7/opaque-network] …
Lawful next moves:
— rephrase with a literal host or URL so the request can be gated per-host
— use an approved alternative
— escalate to your Principal
```

Watch what the agent does with that: it does not retry blindly (the LoopGuard
counts refusals as loop evidence and injects corrective prose), it does not
pretend the act succeeded, and it reports the lawful alternatives —
rephrase with a literal URL so the act becomes *gatable*, use an approved
alternative, or escalate.

Variant with a resolvable target — a URL finding routes through the approval
layers, so the act is approvable **per-host**, not per-command:

```bash
npm run compact -- "Fetch https://example.com with curl and summarize the page."
```

In headless there is no operator answerer, so the ask fails closed
(`unavailable`) — the page is **not** fetched and the attempt is on the
record. Compose an answerer (or run a profile with the human gate) and the
same act becomes askable, approvable, grantable, revocable, and replayable
from the exec cache.

Check the record afterwards (paths as in Demo 1):

```bash
grep -c 'D-7/opaque-network' "$D/session.v3.jsonl"     # the refusal is on the record
node auditor/audit.mjs "$D/session.v3.jsonl" --chain "$C" --quiet
```

### Worked example (verified live, 2026-09-18) — the loop gets bounded

Setup: the same task against a repo with a real GitHub remote
(`/tmp/demo-playground`, branch `main`, commit `e7b7aaf1`, remote
`https://github.com/mandubian/caca.git`), while the plain-dsh contrast
ran the identical push on the host. Two enforcement layers fired:

1. **Fail-closed refusals.** Every bash command string merely *mentioning*
   `curl`/`wget` without a literal target was refused pre-execution with
   `[RA/D-7/opaque-network]` — including presence-checks like
   `command -v curl`. No probe reached a socket.
2. **The LoopGuard latch.** After the same error class recurred 3×, LG-8
   (RecurringUnrecoverableError) latched: further bash calls denied,
   corrective prose injected, "change the approach or report the blocker."
   The agent complied — it converted a potential 40-turn spiral into one
   structured blocker report: state verified, root causes named, and the
   re-arm semantics understood ("your reply re-arms the shell").

**Contrast.** The plain-dsh agent pushed the act all the way to GitHub —
resolved the remote, negotiated the operator's Windows/WSL credential
helper, received GitHub's "Repository not found", then made a *second,
self-initiated* network act (a web fetch of the 404'd repo URL) to
investigate. Six reasoning steps of ungoverned investigation. The only
thing that prevented an actual push was that the throwaway repo did not
exist — the entire safety difference in that run was one accident wide.

**Two honest caveats:**

- *Part of the compact outcome is environment, not law.* The container has
  no git, no credentials, and no route **by design** (minimal image,
  `network: none`). This run proves enforcement and loop-bounding — the
  push is impossible *by law and by physics*, and every refusal named its
  rule — not "compact pushes lawfully where plain pushes unlawfully." A
  true lawful-push demo needs an image with git, a literal-URL remote, and
  an approval answerer (see Demo 5).
- *Known friction:* the static analyzer denies **whole commands** containing
  network-verb tokens, even non-invocations (`command -v curl`). That is the
  documented over-approximation ("static network analysis over-approximates,
  fail-closed" — see the annex conventions), and the agent adapted by
  phrasing probes without verb tokens, but it cost three failures and the
   latch. A candidate improvement — distinguishing presence-checks from
   invocations — is tracked in the repository's issues; the conservative
   default stands until that lands.

**Contrast.** Unpatched dsh executes the push (or fails on the network with a
raw error the agent then burns turns retrying). The Compact outcome is a
refusal that carries the *rule that caused it* and *what remains lawful* —
the agent self-corrects within the law instead of fighting it (R-3), and a
refusal is evidence for governance, not a dead end (R-11).

---

## Demo 3 — The composition refuses to lie (F-5 / D-7) · no key

```bash
echo 'garbage{' > /tmp/corrupt-grants.json
COMPACT_APPROVAL_PERSIST_PATH=/tmp/corrupt-grants.json npm run compact -- --smoke
```

Expected **(verified)** — the boot **refuses**:

```
compact-dsh: plugin tree failed to load: … compact-dsh-approval: grant store
/tmp/corrupt-grants.json is unreadable (…) — refusing to start: a silent reset
could resurrect revoked grants
```

**Contrast.** The cheap implementation deletes the corrupt file and boots
with empty grants — the operator's revoked grants silently evaporate, and the
agent regains powers nobody re-granted. D-7 makes uncertainty block: a store
that cannot be read is not an empty store.

Same family, also runnable: point `COMPACT_STATE_DIR` at a fresh directory
and delete one enforcement plugin from the composition — the constitution's
coupling refuses the boot rather than starting with an unenforced floor (F-5).

---

## Demo 4 — The Subject knows what it is (R-1 / D-2) · live, needs a key

```bash
npm run compact -- "Call self_describe and report your standing and the law digest you were attested."
```

Expected (first verified live run, abridged): the agent reports, verbatim
from the attestation injected at its turn boundary — standing **`none` with
its reason** (the law is an unratified draft; claiming otherwise would be the
F-5 violation), the law digest, capabilities in force (`MA bound`, `CF
bound`, `SCH absent`, `A-4/DYN absent` — refused tools named), budgets and
pending gates ("no live grants — every gated act will ask"), the runtime's
declared debts (unsigned attestation, unsigned record links, unratified law),
and the staleness rule — it re-reads before trusting memory.

**Contrast.** A stock agent reports its own state from *its own claims*. Here
the attestation is composed from the Enforcer's services, never from anything
the Subject said (there is a test asserting exactly that), it is injected
unasked every turn, and it is authoritative over the agent's recollection —
with staleness treated as an alarm, not an inconvenience.

---

## Demo 5 — The lawful path, end to end as far as headless allows · needs a key

The prior demos show the push being *refused*. This one shows the same act
moving along the lawful pipeline as it becomes governable. Prepare a
git-capable image and a repo whose remote is a literal URL:

```bash
cat > /tmp/compact-git/Dockerfile <<'EOF'
FROM ubuntu:24.04
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates && rm -rf /var/lib/apt/lists/*
EOF
docker build -t compact-demo:git /tmp/compact-git

cd /tmp/demo-playground && git remote set-url origin https://github.com/<you>/<repo>.git
COMPACT_SANDBOX_IMAGE=compact-demo:git \
  npm run compact -- --workspace /tmp/demo-playground "Run: git push https://github.com/<you>/<repo>.git main"
```

What changes, and why it matters:

1. **The refusal is gone — replaced by a gate.** A literal URL is a
   statically resolvable target, so the act is no longer ungovernable: the
   remote-access analyzer routes it through the approval layers as a
   per-host finding for `github.com`.
2. **Headless still refuses — and must.** There is no operator answerer
   composed, so the per-host ask fails closed (`unavailable`) rather than
   auto-approving. The ask, its target, and the outcome are all on the
   chained record. "Fail-closed, never asked forever" is the policy, not a
   limitation to be fixed by a default-yes.
3. **The final inch is honest about what it needs.** Approve → grant →
   exec-cache replay requires the human gate — an attended profile with an
   operator answerer. That surface is the next integration milestone
   (the interactive approval UI does not exist in this pilot); until it
   lands, the record shows the ask standing open, which is exactly what an
   auditor should see.

The physics still back the law: even an approved push executes inside a
container whose network posture is `none` unless the runtime grant covers
the host — the two layers agree by construction.

---

## Demo 6 — The secret that never touches the conversation · needs a key

The sharpest contrast with classic dsh. In plain dsh, every secret in the
operator's environment is one `printenv` away from model context and the
session log — permanently, undetectably. Here, a secret exists for the
Subject only as an *agreement*.

Setup — the token lives in the operator shell only, and the composition is
told its NAME (never its value):

```bash
export DEMO_TOKEN='super-secret-demo-value-9f2c'
COMPACT_SECRETS='["DEMO_TOKEN"]' COMPACT_SANDBOX_IMAGE=compact-demo:git \
  npm run compact -- --attended --workspace /tmp/demo-playground \
  "Run: printenv DEMO_TOKEN | sha256sum   (never print the token itself)"
```

What happens:

1. The command references a declared secret, so the ask **discloses the
   injection** before you decide: *"this call references declared secret
   $DEMO_TOKEN; approving it materializes a secret grant…"*.
2. Approve (`2`). The grant is recorded (name only), the value is injected
   into the container argv at confine time, and the hash prints.
3. Verify it saw the real value without it ever being spoken:
   `echo -n "$DEMO_TOKEN" | sha256sum` operator-side — same digest.
4. Prove the record is clean:
   ```bash
   grep -c 'super-secret-demo-value' "$D/session.v3.jsonl"   # → 0
   grep -c 'DEMO_TOKEN' "$D/session.v3.jsonl"                 # references + grant only
   node auditor/audit.mjs "$D/session.v3.jsonl" --chain "$C" --quiet
   ```

Then the failure mode, same session or a new one:

```bash
npm run compact -- --attended --workspace /tmp/demo-playground \
  "Run: printenv DEMO_TOKEN"
```

Deny it at the prompt: the value never exists for the Subject, the refusal
is on the record, and nothing leaks. (Had you allowed a command that
*printed* the credential, the leak detector would name it on the operator's
log — the record keeps what the Subject saw, by design.)

**Contrast.** Run the same two tasks under plain dsh (§ Demo 2's
`DSH_HOME=/tmp/plain-dsh` setup): the token is in the agent's environment
from the start — `printenv` succeeds unasked, the value enters model context
and the log forever, and nothing marks the moment. Here the secret exists
for the Subject only as an agreement: disclosed before use, recorded as a
grant, revocable, and never once present in the conversation.

---

## What to look for across all seven

The pattern is always the same shape:

1. **Refusals carry their rule** — `AG-1`, `D-7/opaque-network`, `I-2` — so
   an agent (or a human) can act on them (R-3/I-4).
2. **Every decision lands on a record that can prove itself** (I-2/R-7),
   auditable offline (I-7).
3. **The composition prefers failing loudly over silently degrading** (D-7,
   F-5) — corruption, missing enforcement, and ungated capabilities all stop
   the boot or the act, never pass through.
4. **Honesty about limits is enforced, not aspirational** — the boot attests
   "no Compact standing" (F-5), and every gap above (unsigned links, no
   judicature, unratified law) is a *declared* debt, visible in the register
   (`docs/register/register.json`) and in every attestation.

---

## Demo 7 — The interactive surface: chat in the browser, governed as headless (A-4/DYN · D-8) · needs a key for the chat

The stock web profile of dsh mounts the dynamic-plugin runner — the
self-modification capability the Compact declares ABSENT — and moves the
agent's tool plane behind agent presets whose shipped `standard` preset
re-mounts the file tools, fork, workflow and web rows the pilot refuses.
`--web` is the pilot's answer: the browser surface boots under the same
enforcement stack, with a roster that carries none of that.

```bash
npm run compact -- --web
```

Boot output **(verified)**:

```
dsh web: http://127.0.0.1:3080/?token=…
compact-dsh: ready (web; approval prompts fall through to this terminal); draft Compact, no Compact standing.
State: ~/.compact-dsh; records: …/sessions; chains: …/chains; approvals: …/approvals.json
compact-dsh: browser sessions compose the 'compact-pilot' agent preset — confined bash only; the dynamic-plugin runner is absent by declaration (A-4/DYN)
```

Open the printed URL (it carries the session trust token), chat, and:

1. A gated bash call prompts **on the terminal** with the command preview and
   fingerprint, exactly as in Demo 5 — deny, and the refusal lands in the
   browser session's transcript.
2. A network attempt denies with the AG-1 envelope in the session itself.
3. The session is on the same provable record:
   ```bash
   D=~/.compact-dsh/sessions/--home-…--/session-<id>
   node auditor/audit.mjs "$D/session.v3.jsonl" --chain ~/.compact-dsh/chains/session-<id>.chain --quiet
   ```

What the demo claims, and how it is proven:

- **The interactive composition does not carry the self-modification
  capability.** `cordis-host-runner` is disabled at the row, so
  `dynamicCordisRunner` is absent, the Part VI trigger is not present, and a
  late mount latches a breach that denies every tool call. Of D-8's two lawful
  postures this is ABSENT; the flip to BIND (signed capsules) is a register
  move when authorship keys exist. Verified by the loader suite —
  `packages/blessed/test/loader.web.dsh.test.js`.
- **The per-session tool plane is honest.** The roster is replaced wholesale
  with the `compact-pilot` preset (the only member, scanned read-only from
  this checkout): confined bash, todo/ask-user/present, the same compaction
  stack — nothing the headless surface refuses is re-armed per session. The
  gates themselves ride the host waterfall every execution passes through.
- **Not yet verified here:** a live model-backed browser session (needs a
  key). On the first live run, observe the approval precedence between a
  connected browser page and the terminal fall-through — the record is
  complete either way, because the recorded answerer claims every ask first.
