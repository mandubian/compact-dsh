# @autonoetic/dsh-allowlist-gate

Phase 0 plugin (port plan item 2): a `tools/pre-execute` deny-by-allowlist
gate issuing Compact-shaped denial envelopes — rule ID, reason, lawful next
moves (R-3/I-4). Content-blind by design: it inspects the target, never the
message (R-9).

```js
// dsh cordis.yml
- @autonoetic/dsh-allowlist-gate:
    allowlist:
      - api.example.com
      - "*.cdn.example.net"
      - https://mirror.example.org/v1/
```

Tests: `npm test` (node:test, no build step). dsh pin: `~0.1.5-rc.1`.
