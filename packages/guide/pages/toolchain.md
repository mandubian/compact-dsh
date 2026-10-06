# The toolchain: immutable by design, and where dependencies go

Every `tool:bash` act runs in a fresh container whose root filesystem is read-only (`clause:CF-1`), built from one digest-pinned image (`clause:CF-2`). The system toolchain inside your act — the package stores, the interpreters, everything under `/usr` — therefore cannot change, no matter what the operator approves. An approval that cannot change anything is a survey: a system-package-manager install is refused **before** any approval fires, with an `[SC/CF-1/immutable-toolchain]` envelope that names the lawful moves. This page is those moves, in full.

Your per-turn attestation states this posture — the image, its digest, the immutability, and where dependencies belong (`tool:self_describe`, `clause:R-1`). Where the attestation and this page disagree, the attestation wins.

## The four lawful moves

**1. Language libraries — install into the workspace.** A virtual environment inside the workspace is yours to write (in `workspace-write` mode):

    python3 -m venv .venv && .venv/bin/pip install <packages>

Then invoke it by path (`.venv/bin/python`, `.venv/bin/pip`) — a bare `pip` is the image's system pip, and there is no system to install into. The same pattern holds for other ecosystems: a workspace-local prefix or a project-scoped store. This is the move the refusal's envelope names first, because it is the one that needs nobody: no ask, no grant, no restart.

**2. Self-contained tools — fetch a static binary by path.** Many CLI tools ship as single static binaries. Fetch one into the workspace and invoke it by path:

    curl -L -o bin/jq <URL> && chmod +x bin/jq
    bin/jq . data.json

The fetch is a network act like any other: it asks per host (`page:network`). A `./bin/` directory kept in the workspace persists across acts, so this is a one-time cost per workspace.

**3. Operator-provisioned host tools — a read-only mount grant.** If the host already has what you need, request the narrowest directory that covers it with `tool:sandbox_request_mount` (mode `ro`, with a one-sentence justification). The operator decides at the gate; the grant is read-only-capped, session-scoped and time-bounded (`page:sandbox`). List and revoke with `command:/grants-list` and `command:/grants-revoke`.

**4. System packages — the operator's act.** When you genuinely need packages installed into the image itself (compilers, system libraries), say so to your Principal and stop there. The image must be rebuilt and re-declared: the operator bakes a derived image, then sets `env:COMPACT_SANDBOX_IMAGE` and `env:COMPACT_SANDBOX_IMAGE_DIGEST` and restarts the composition. The governed never bake their own confinement — the build runs on the operator's daemon, by the operator's hands (`clause:CF-2`). Until the re-declaration happens, the refusals keep coming, and they are correct.

## Why the toolchain is the operator's act (`clause:CF-2`)

The image is a reused execution environment, so it carries its acquisition history keyed by content digest: a tag is a wish, the digest is the fact. The runtime re-resolves the digest at every confinement — an image whose content drifted off its record is refused by name (`CF-2/digest-drift`) rather than trusted. That is why "just install it into the image" cannot be a Subject-side act: a mutable toolchain inside the act would be the Subject rewriting the evidence of what it is running under. The chain of custody runs operator → digest → declaration → confinement. The full design is in `file:docs/concept-supply-chain.md` and `page:sandbox`.

## What persists, and what does not

Two different caches, and confusing them is the classic mistake:

- **Filesystem memory** is the workspace bind. `.venv/`, `./bin/`, build artifacts and downloaded data written there survive across every act, because every act mounts the same workspace. Nothing else survives: each act starts from the image afresh, `/tmp` is a per-call tmpfs, and in `read-only` mode nothing can be written at all (`page:sandbox`).
- **Consent memory** is the operator's grant store. An approval, an egress grant or a mount grant exists there — not on your disk, and not in your container. The live-session confusion to learn from: approvals had been granted, the environment still came back empty, because consent memory and filesystem memory are different caches. A grant authorizes an act; it does not install anything.

## For the operator

If a session keeps hitting a missing tool, the fix is one of the four moves — and the last one is yours: bake the tooling into a derived image and re-declare the digest, or provision a tools directory the session can request read-only. The runtime surfaces are in `page:running` and `page:sandbox`.
