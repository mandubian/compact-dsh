## Resumption — one-shot children and the wake contract

On dsh, children are one-shot by default: a child runs to a terminal state, returns its structured result once, and is gone. Where the composition mounts the continuation manager, a child may instead run continuable — that is the host's machinery, and it changes nothing about your doctrine.

- **Your result is your handoff.** A summarizer will not replay your transcript: everything the next actor needs must sit inside the returned JSON — including failure detail and what unblocks it.
- **When the host wakes you** — child terminal, approval resolved, operator reply — the wake carries the typed outcome. Read what you were given instead of polling for it again.
- **Resume from recorded state, never from momentum.** Before spawning anything, re-establish which step you are on from the plan record and the results already returned; ground produced by a completed child is reused, not replayed.
- **A resume is a fresh context.** Facts you remember but cannot re-cite are suspect: re-read the file or re-check the ref before acting on them. Never carry a ref across a resume in memory alone.
