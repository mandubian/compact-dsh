# Decision record — the plain-dsh distribution: one bundle, the trial path, and its declared gaps

**Status: ADOPTED — closes the #140→#143 chain** ([#140](https://github.com/mandubian/compact-dsh/issues/140)
the artifact, #144; [#141](https://github.com/mandubian/compact-dsh/issues/141)
the posture layer, #145; [#142](https://github.com/mandubian/compact-dsh/issues/142)
the probe, #146; this record). Recorded 2026-10-03. Grounding:
[the probe transcript](dist-probe.md) (every claim below that matters at
runtime is (verified) there), and the launcher doctrine in the README's
"Plain dsh vs this composition" — same host, law added; this record decides
what it means to add the law to a host **the launcher does not own**.

## The question

The Compact runs on plain dsh profiles through the same seam every plugin
rides — dsh's plugin manager installs ONE package into a profile and enables
its bundle. Can the composition travel that seam, and what is honestly true
once it does? The launcher's guarantees (generated empty root, state
isolation, pre-boot digest verification, one boot one workspace) are
process-level; a profile has none of them. The answer is yes, as **the trial
path**, with the differences named rather than hidden.

## Decision 1 — one distributable package, not sixteen published ones

`tools/dist.mjs` (`npm run dist`) packs the whole composition as one
tarball: the dependency closure vendored as `bundleDependencies` inside the
package's own `node_modules/`, the two bundle patch layers copied
byte-faithful with exactly three module-resolving row rewrites, and root
shims re-exporting the row-resolved modules. The pack refuses if any
workspace package is unreachable from the composition roots — the artifact
carries the whole law or nothing.

Sixteen published packages was the alternative and is worse on every axis
that matters: lockstep releases, registry hygiene, and install instructions —
for **zero dsh-visible difference**, because blessed already imports and
mounts the children itself (`packages/blessed/src/index.js`). The
21-package layout is a testing boundary, not a load boundary; the artifact
preserves it inside one installable name.

Three constraints shaped the packer, each caught by the live install test
rather than inspection (all pinned in `tools/dist.test.mjs`):

1. **`file:` dependencies do not relocate.** pnpm resolves the `file:` specs
   of an *installed tarball* against the installing project's directory
   (`ERR_PNPM_LINKED_PKG_DIR_NOT_FOUND`) — siblings must ship inside the
   tarball's own `node_modules/` as bundled dependencies.
2. **Exports targets may not traverse a `node_modules` segment.** The bundle
   root re-exports blessed/provider/card/web through root shims; the ask
   card's client bundle is a pack-time copy (the client host serves it by
   file path).
3. **Patch rows resolve against the profile's own baseUrl.** Only the bundle
   package itself is nameable from a row — hence the three rewrites, with
   occurrence counts asserted so a new `name:` row fails the pack.

## Decision 2 — the posture travels with the bundle; the pilot does not change

A profile boot arms what the launcher refuses: `profileContext` flips the
base bundle's profile-gated rows active (`cordis-host-runner`, `ptc-runtime`,
`directory-picker`, the shipped presets that re-mount host-plane tools per
session). The pilot disables these in the launcher's web rows; a plain
profile has no launcher. So the posture rides the bundle as two more patch
files (`tools/dist.posture.patch.yml`, the pilot preset copy) — applied after
the web-app rows they refuse, the same ordering rule the launcher follows.
The workspace packages, the launcher, and the pilot's composed stack are
untouched; only the packer's output grew.

State defaults follow env-first derivation: the launcher's env names when
the operator exports them, else the profile's own `compact-data/`, else the
record provider's explicit-path refusal stands. **The sandbox image is never
defaulted** — blessed validates it at mount, so an operator who exports
nothing is refused at boot by the error that names the move; the image and
its digest are the operator's act, verified against the daemon at confine
time. That refusal is the law working, not a gap.

## Decision 3 — the A-4 posture on a foreign host: a declared gap

The pilot refuses `plugin-manager` and `hmr` outright (A-4/DYN: the
self-modification surface is absent and enforced as absent). The distributed
composition **does not refuse them** — deliberately. This is the one design
call deferred from #141, and the reasoning:

- The trial path's premise is riding the host's own dynamism — it was
  *installed through* the plugin manager. Refusing the host's management
  surface from inside a guest bundle would fight the install surface itself.
- On a foreign host, the host's rows are the operator's call. What the
  composition owns is what its gate enforces, and that stays fully live: a
  boot whose composition mounts a `dynamicCordisRunner` refuses to start; a
  runner mounted late latches a capability-gate breach that denies every
  tool call; a plugin-manager toggle that re-arms the runner refuses the
  next boot. The clause rides with the plugin.
- The pilot's own stance is unchanged — the launcher's web rows still refuse
  both rows on the attested surface.

What is honestly weaker on the trial path, named here and in the README: no
attested boot (the profile is editable YAML, not the launcher's generated
empty root — an operator can weaken posture rows the bundle ships); no state
isolation (the profile shares the operator's dsh home); no pre-boot digest
verification of the sandbox image; and the record/chain/grants live wherever
the profile's derivation puts them, outside any 0700 state dir.

## Decision 4 — publishing stays deferred

The local trial is complete without it: `npm run dist` → pnpm add → boot is
one copy-pasteable sequence (the README's "The trial path" section, and
[the probe](dist-probe.md)). Publishing is outward-facing and carries open
questions that are the maintainer's call: registry choice (public npm vs
GitHub Packages vs a private mirror), the package name's claim (`compact-dsh`
vs a scoped name), release cadence versus the draft law's versioning, and a
CI publishing pipeline with provenance. Nothing in this chain blocks on
those answers; when they land, the artifact already carries everything a
publish needs.

## Found along the way

- **The auditor v4 bug (probe-caught).** The offline auditor's preamble strip
  recognized only dsh v3 session headers; every 0.2.0-format (v4) log —
  including the pilot's own — audited as an I-2 contiguity violation. Fixed
  (`auditor/audit.mjs`), pinned in `tools/register.test.mjs`. A distribution
  path that audits its own product differently than the pilot's was never
  going to survive contact.
- **Probe scope, stated.** The end-to-end probe drives governed calls through
  the tool waterfall with no model and no browser session; the `tool/call`
  and `tool/result` record events are the agent loop's contribution and
  remain unexercised on the trial path until a model-driven session runs.
  The probe re-arms the host-plane `tool-bash` row (the web profile keeps
  host tools behind presets); the read-only `cordis-inspect-providers` row
  pends on its disabled host-runner backend (ungated per the register —
  `cordis_inspect_*` is not mutation). Named in [dist-probe.md](dist-probe.md).
- **The CLI pnpm wrinkle.** `dsh plugin --profile X add` initializes the
  profile with a workspace file, then its raw pnpm forward trips
  `ERR_PNPM_ADDING_TO_ROOT` until `-w` is passed; the plugin-manager
  service path (the web UI) constructs its own arguments and does not. A
  one-liner install story waits on either an upstream fix or publishing.

## Register impact

None. No evidence text becomes false: A-4's evidence speaks of the pilot's
own interactive surface ("the launcher's web rows disable…"), which remains
exactly true; the trial path is a different composition of the same code,
whose posture this record declares. `verify-register` stays green (71
entries, 48 enforced), and the register was not edited by this chain.
