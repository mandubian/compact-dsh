// The compact ask card — a client-side rendering of the approval ask (#90).
//
// A static web client plugin: the composition mounts the loader row
// (cordis.patch.yml), the client-modules host serves this bundle under
// /plugins, and the web shell materializes it and calls apply(ctx). The
// plugin registers a higher-priority takeover on the `conversation.composer`
// chain: when the pending interaction is an approval, this card renders in
// the composer's place; when it is not, the select declines and upstream's
// ApprovalPanel (priority 1) is elected instead — decline means invisible,
// never blocking.
//
// What the card shows is governed by the principle the 2026-09-25 live
// capture settled (docs/decision-envelope-tier.md): the ask's disclosure IS
// the canonical reason — static prose never wraps it. The card therefore
// adds no prose: it parses the canonical envelope text (the format is
// lint-pinned by the approval suite's wire lint) and re-lays it out —
// gate/rule chip, the COMMAND the ask is about (read from the session's
// chat state by callId — the same lookup upstream's ApprovalCommand
// performs for its detail slot, which a full composer takeover otherwise
// loses), the reason with its line breaks intact (the upstream headline
// collapses whitespace), one row per reason line with the composer's
// disclosure labels bolded (#173 — layout, not prose: the label names the
// row, the row's sentence does the talking), the lawful next moves as a
// real list — and always keeps the verbatim text one disclosure away. Where the text does not
// parse as a canonical envelope (any other ask riding the same waterfall),
// the card degrades to the upstream face with pre-wrap: the reason shown
// as-is, same two buttons. Nothing is invented, nothing is duplicated,
// nothing is rewritten: the reason and the move rows are verbatim
// substrings of the source (each row carries its own dash exactly when the
// builder wrote one), only whitespace-only rows are skipped at render, so
// the R-3 floor — the rule and EVERY move — survives the layout.
//
// Hand-authored in the loader-factory form the served bundles use; there is
// no build step to drift from.
window.__ModuleLoader__.load({
	id: 'compact-dsh-card',
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' });
		let react = require('react');
		let primitives = require('@deepseek-ai/dsh-client-ui-primitives');

		// ── the parse: the canonical text is the single source ──

		// The eleven gate families (docs/concept-envelope-rendering.md). The
		// ruleId may itself carry slashes (AG/I-5/secret-use), so the head is
		// `[<gate>` + optional `/<ruleId>]` — then exactly the one space the
		// canonical builder emits (buildEnvelope: `'] ${reason}'`); everything
		// after it stays verbatim, so the parser normalizes nothing.
		const GATE_HEAD = /^\[([A-Z]{2})(?:\/([^\]]+))?\] /;
		const MOVES_MARKER = 'Lawful next moves:';
		// #173: the composer emits each disclosure on its own labeled line —
		// `Replay: …`, `Connectivity: …` — the structure the moves block has
		// always had. The label is layout, not prose: the card renders one row
		// per line and BOLDS the label (a span, CSS below). The pattern is
		// generic so the card can never drift from the composer's label set —
		// and it applies only on the parsed (canonical) face; the fallback
		// face renders foreign text as-is, unstyled.
		const LABEL_LEAD = /^([A-Z][A-Za-z]+): /;

		/** Parse the canonical envelope text into its structured parts.
		 * Returns null for anything that is not a canonical envelope — the
		 * caller renders the fallback face. VERBATIM throughout: the reason
		 * and `moves` are substrings of the source, never trimmed or
		 * filtered — a dropped or rewritten line would narrow the R-3 floor
		 * or change the text. Blank move lines are skipped only at render
		 * time (whitespace-only rows carry no content). */
		function parseAsk(text) {
			if (typeof text !== 'string' || text.length === 0) return null;
			const lines = text.split('\n');
			const head = GATE_HEAD.exec(lines[0]);
			if (!head) return null;
			const markerAt = lines.indexOf(MOVES_MARKER, 1);
			const rest = markerAt === -1 ? lines.slice(1) : lines.slice(1, markerAt);
			return {
				gate: head[1],
				ruleId: head[2] ?? null,
				reason: [lines[0].slice(head[0].length), ...rest].join('\n'),
				moves: markerAt === -1 ? [] : lines.slice(markerAt + 1),
			};
		}

		/** The chain select: claim approval pending-interactions, decline
		 * everything else (the composer chain then elects upstream's panel).
		 * Duck-typed on the pending-interaction kind discriminator, not on an
		 * upstream class — the discriminator is its documented consumer face. */
		function selectAsk({ pendingInteraction }) {
			return pendingInteraction != null && pendingInteraction.kind === 'approval' ? pendingInteraction : null;
		}

		// ── the card ──

		// The command of the correlated tool call, read from the session's
		// chat state — the SAME lookup upstream's ApprovalCommand performs
		// for its `conversation.approval.detail` slot. The approval wire
		// carries no arguments (the operator must see what they decide on,
		// but the wire is not the place), so the transcript node reached by
		// callId is the only honest source. Absent useChat (tests, other
		// surfaces) or a pruned node → no command box, never a guess.
		// The args JSON rides `argsRaw` on the pinned build; `arguments` is
		// accepted too — and every node is guarded on its own, so one
		// malformed entry can never hide the call in another.
		function commandOfRoot(root) {
			if (root == null || typeof root !== 'object') return undefined;
			const raw = typeof root.argsRaw === 'string' ? root.argsRaw
				: typeof root.arguments === 'string' ? root.arguments : undefined;
			if (raw === undefined) return undefined;
			try {
				const args = JSON.parse(raw);
				return typeof args?.command === 'string' ? args.command : undefined;
			} catch {
				return undefined;
			}
		}

		function useCorrelatedCommand(callId, useChat) {
			return (useChat ?? ((selector) => selector(undefined)))((snapshot) => {
				if (callId == null || !snapshot || !snapshot.nodes) return undefined;
				for (const node of snapshot.nodes.values()) {
					try {
						const root = node && node.kind === 'tool-call' ? node.data.root : undefined;
						if (root != null && typeof root === 'object' && root.callId === callId && !('kind' in root)) {
							const command = commandOfRoot(root);
							if (command !== undefined) return command;
						}
					} catch { /* one malformed node must not hide the call in another */ }
				}
				return undefined;
			}) ?? undefined;
		}


		// ── #201: the pattern offers, fetched from the Enforcer's own view ──
		// The card renders the server-computed rows and sends a guarded PICK:
		// the server re-validates the index against its own list (a click
		// picks, never authors — D-8), then the ordinary
		// approval.answer('allowed-once') resolves the chain and the recorded
		// answerer materializes exactly as it does for the terminal. Any
		// failure (no view, 401, cleared) degrades to today's two buttons.

		function rpcEnvelope(method, payload) {
			const crypto = globalThis.crypto;
			const rpcId = crypto && typeof crypto.randomUUID === 'function'
				? crypto.randomUUID()
				: 'rpc-' + Date.now() + '-' + Math.random().toString(16).slice(2);
			return { type: 'client-request', rpcId, method, payload };
		}

		async function callCardApi(method, payload) {
			const res = await fetch('/api/' + method, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(rpcEnvelope(method, payload)),
			});
			if (!res.ok) throw new Error('compact-card-api ' + res.status);
			const body = await res.json();
			if (body == null || body.type !== 'server-response' || body.error != null) {
				throw new Error(body?.error?.message ?? 'compact-card-api error');
			}
			return body.result;
		}

		async function fetchOffers(callId) {
			// the payload is EXACTLY { args: {…} } — the gateway refuses any
			// extra key (remoteRequest: "must contain exactly one plain-object
			// args field"); the method rides the endpoint and the envelope
			const view = await callCardApi('compact-card-api/decidingView', {
				args: { callId },
			});
			return Array.isArray(view?.offers) ? view.offers : [];
		}

		async function pickPattern(callId, index, runtime) {
			return callCardApi('compact-card-api/patternAnswer', {
				args: { callId, index, runtime },
			});
		}

		function CompactCard(props) {
			const approval = props.matched;
			const parsed = parseAsk(approval?.reason);
			const command = useCorrelatedCommand(approval?.callId, props.useChat);
			const answeredState = react.useState(false);
			const answered = answeredState[0];
			const setAnswered = answeredState[1];
			// #201 — the offers arrive from the Enforcer's own deciding view,
			// fetched once per ask; the test face passes them via props.offers.
			const offersState = react.useState(Array.isArray(props.offers) ? props.offers : null);
			const offers = offersState[0];
			const setOffers = offersState[1];
			const runtimeState = react.useState(false);
			const runtime = runtimeState[0];
			const setRuntime = runtimeState[1];
			const widenErrorState = react.useState(null);
			const widenError = widenErrorState[0];
			const setWidenError = widenErrorState[1];
			react.useEffect(() => {
				let live = true;
				if (Array.isArray(props.offers) || approval?.callId == null) return undefined;
				fetchOffers(approval.callId).then((rows) => {
					if (live && rows.length) setOffers(rows);
					else if (live) setWidenError('no pattern offers for this ask');
				}).catch((e) => { if (live) setWidenError(String(e?.message ?? e)); });
				return () => { live = false; };
			}, [approval?.callId]);
			const answer = (outcome) => {
				setAnswered(true);
				approval.answer(outcome).catch(() => setAnswered(false));
			};
			// the guarded pick: server validates first (awaited), then the
			// ordinary allow resolves the chain with the pick on the view
			const answerPattern = (index) => {
				setAnswered(true);
				pickPattern(approval.callId, index, runtime)
					.then(() => approval.answer('allowed-once'))
					.catch(() => setAnswered(false));
			};
			const reason = parsed ? parsed.reason : String(approval?.reason ?? '(no reason given)');
			return react.createElement('div', { className: 'compact-card-root', 'data-compact-card': '' },
				react.createElement('div', { className: 'compact-card-card' },
					react.createElement('div', { className: 'compact-card-strip' },
						react.createElement('span', { className: 'compact-card-dot' }),
						'Waiting for approval',
					),
					react.createElement('div', { className: 'compact-card-body', 'data-approval-scroll': '', tabIndex: 0, role: 'group', 'aria-label': 'Approval details' },
						parsed ? react.createElement('span', { className: 'compact-card-chip' },
							parsed.gate + (parsed.ruleId ? '/' + parsed.ruleId : '')) : null,
						// The decision itself, first: the exact command (or tool) this
						// ask is about — what "yes" runs — before any consequence prose.
						command != null ? react.createElement('div', { className: 'compact-card-deciding' },
							react.createElement('div', { className: 'compact-card-deciding-label' }, 'You are approving'),
							react.createElement('pre', { className: 'compact-card-command' }, command)) : null,
						react.createElement('div', { className: 'compact-card-reason' },
							// #173: one row per source line; a labeled row bolds its
							// label — the text concatenates back to the source verbatim
							parsed ? reason.split('\n').map((line, i) => {
								const m = LABEL_LEAD.exec(line);
								return m
									? react.createElement('div', { className: 'compact-card-reason-row', key: i },
										react.createElement('span', { className: 'compact-card-reason-label' }, m[1] + ':'),
										' ' + line.slice(m[0].length))
									: react.createElement('div', { className: 'compact-card-reason-row', key: i }, line);
							}) : reason),
						// Each move row IS its source line — dash included when the
						// builder wrote one, absent when it didn't; the only rows
						// skipped are whitespace-only (no content to drop).
						parsed && parsed.moves.some(move => move.trim().length > 0) ? react.createElement('div', { className: 'compact-card-moves' },
							react.createElement('div', { className: 'compact-card-moves-label' }, 'Lawful next moves'),
							react.createElement('ul', { className: 'compact-card-moves-list' },
								parsed.moves.filter(move => move.trim().length > 0).map((move, i) => react.createElement('li', { key: i }, move)))) : null,
						react.createElement('details', { className: 'compact-card-raw' },
							react.createElement('summary', null, 'Raw envelope'),
							react.createElement('pre', null, String(approval?.reason ?? '')))),
					widenError && !answered ? react.createElement('div', { className: 'compact-card-offers', 'data-widen-error': '' },
						react.createElement('div', { className: 'compact-card-moves-label' }, 'Widen unavailable'),
						react.createElement('div', { className: 'compact-card-reason-row' }, widenError + ' — the two buttons stand.')) : null,
					Array.isArray(offers) && offers.length && !answered ? react.createElement('div', { className: 'compact-card-offers' },
						react.createElement('div', { className: 'compact-card-moves-label' }, 'Widen — allow + cover (the pass, stated above)'),
						offers.map((o, i) => react.createElement(primitives.Button, {
							key: i, variant: 'outline', className: 'compact-card-offer',
							disabled: answered, onClick: () => answerPattern(i),
						}, 'Allow + cover ' + o.text + ' — ' + o.scope + (o.methodClass ? ', ' + o.methodClass : '') + ' (' + (o.ttlMs % 3_600_000 === 0 ? (o.ttlMs / 3_600_000) + 'h' : (o.ttlMs / 60_000) + 'min') + ', ' + o.maxUses + ' uses)')),
						react.createElement('label', { className: 'compact-card-runtime' },
							react.createElement('input', { type: 'checkbox', disabled: answered, checked: runtime, onChange: (e) => setRuntime(e.target.checked === true) }),
							' every session of this runtime (the night pass)')) : null,
					react.createElement('div', { className: 'compact-card-actions' },
						react.createElement(primitives.Button, { variant: 'outline', className: 'compact-card-reject', disabled: answered, onClick: () => answer('rejected') }, 'Deny'),
						react.createElement(primitives.Button, { variant: 'primary', disabled: answered, onClick: () => answer('allowed-once') }, 'Allow once'))));
		}

		// ── the plugin: one composer-takeover registration, priority 0 ──
		// (upstream's ApprovalPanel registers priority 1; the chain elects the
		// lowest priority whose select matches, so ours claims approval asks
		// and upstream keeps everything else)

		const inject = ['slots'];

		function apply(ctx) {
			ctx.slots.inject('conversation.composer', () => ctx.slots.register({
				name: 'conversation.composer',
				priority: 0,
				select: selectAsk,
			}, CompactCard));
		}

		// ── styles (injected at materialization; lives in the factory closure
		// so the lazy-CJS model keeps side effects at materialization time) ──

		const CSS = [
			'.compact-card-root{padding:8px calc(var(--dsh-composer-side-clearance,16px) + 16px) 12px;display:flex;flex-direction:column;align-items:center}',
			'.compact-card-card{width:100%;max-width:var(--dsh-chat-content-width,748px);border:1px solid var(--dsw-alias-state-warn-secondary,#e5b567);border-radius:16px;background:var(--dsw-specific-input-major,#fff);box-shadow:var(--dsw-shadow-lv2,0 4px 16px #0000001a);overflow:hidden}',
			'.compact-card-strip{background:var(--dsw-alias-state-warn-tertiary,#faf3e3);color:var(--dsw-alias-state-warn-primary,#8a6d1a);display:flex;align-items:center;gap:8px;padding:10px 16px;font-size:13px;line-height:18px;font-weight:500}',
			'.compact-card-dot{width:8px;height:8px;border-radius:50%;background:var(--dsw-alias-state-warn-primary,#8a6d1a);flex:none}',
			'.compact-card-body{box-sizing:border-box;max-height:var(--dsh-composer-text-max-height,336px);display:flex;flex-direction:column;gap:8px;padding:12px 16px 0;overflow-y:auto}',
			'.compact-card-chip{display:inline-flex;align-self:flex-start;font-family:var(--ds-font-family-code,ui-monospace,monospace);font-size:12px;line-height:18px;padding:1px 8px;border-radius:6px;background:var(--dsw-alias-state-warn-tertiary,#faf3e3);color:var(--dsw-alias-state-warn-primary,#8a6d1a)}',
			'.compact-card-deciding{display:flex;flex-direction:column;gap:4px}',
			'.compact-card-deciding-label{color:var(--dsw-alias-label-tertiary,#6e7781);font-size:12px;font-weight:500;text-transform:uppercase;letter-spacing:.04em}',
			'.compact-card-command{margin:0;font-family:var(--ds-font-family-code,ui-monospace,monospace);font-size:13px;line-height:20px;white-space:pre-wrap;word-break:break-all;color:var(--dsw-alias-label-primary,#1f2328);background:var(--dsw-specific-input-major,#f6f8fa);border:1px solid var(--dsw-alias-border-l2,#d0d7de);border-radius:8px;padding:8px 10px;max-height:120px;overflow-y:auto}',
			'.compact-card-reason{display:flex;flex-direction:column;gap:4px;color:var(--dsw-alias-label-primary,#1f2328);font-size:14px;line-height:21px}',
			'.compact-card-reason-row{white-space:pre-wrap;word-break:break-word}',
			'.compact-card-reason-label{font-weight:700}',
			'.compact-card-moves{display:flex;flex-direction:column;gap:4px}',
			'.compact-card-moves-label{color:var(--dsw-alias-label-tertiary,#6e7781);font-size:12px;font-weight:500;text-transform:uppercase;letter-spacing:.04em}',
			'.compact-card-moves-list{margin:0;padding:0;list-style:none;display:flex;flex-direction:column;gap:2px}',
			'.compact-card-moves-list li{color:var(--dsw-alias-label-primary,#1f2328);font-size:13px;line-height:20px;white-space:pre-wrap;word-break:break-word}',
			'.compact-card-raw{color:var(--dsw-alias-label-tertiary,#6e7781);font-size:12px}',
			'.compact-card-raw summary{cursor:pointer;user-select:none;width:fit-content}',
			'.compact-card-raw pre{margin:6px 0 0;font-family:var(--ds-font-family-code,ui-monospace,monospace);font-size:12px;line-height:18px;white-space:pre-wrap;word-break:break-word;background:var(--dsw-alias-state-warn-tertiary,#faf3e3);border-radius:8px;padding:8px 10px;max-height:200px;overflow-y:auto;color:var(--dsw-alias-label-secondary,#424a53)}',
			'.compact-card-actions{display:flex;justify-content:flex-end;gap:8px;padding:12px 16px 14px}',
		].join('\n');

		if (typeof document !== 'undefined' && document.querySelector('style[data-plugin="compact-dsh-card"]') === null) {
			const tag = document.createElement('style');
			tag.dataset.plugin = 'compact-dsh-card';
			tag.textContent = CSS;
			document.head.appendChild(tag);
		}

		exports.parseAsk = parseAsk;
		exports.selectAsk = selectAsk;
		exports.CompactCard = CompactCard;
		exports.rpcEnvelope = rpcEnvelope;
		exports.fetchOffers = fetchOffers;
		exports.pickPattern = pickPattern;
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
