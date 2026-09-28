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
// gate/rule chip, the reason with its line breaks intact (the upstream
// headline collapses whitespace), the lawful next moves as a real list —
// and always keeps the verbatim text one disclosure away. Where the text
// does not parse as a canonical envelope (any other ask riding the same
// waterfall), the card degrades to the upstream face with pre-wrap: the
// reason shown as-is, same two buttons. Nothing is invented, nothing is
// duplicated, nothing is rewritten: the reason and the move rows are
// verbatim substrings of the source (each row carries its own dash exactly
// when the builder wrote one), only whitespace-only rows are skipped at
// render, so the R-3 floor — the rule and EVERY move — survives the layout.
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

		function CompactCard(props) {
			const approval = props.matched;
			const parsed = parseAsk(approval?.reason);
			const answeredState = react.useState(false);
			const answered = answeredState[0];
			const setAnswered = answeredState[1];
			const answer = (outcome) => {
				setAnswered(true);
				approval.answer(outcome).catch(() => setAnswered(false));
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
						react.createElement('div', { className: 'compact-card-reason' }, reason),
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
			'.compact-card-reason{white-space:pre-wrap;word-break:break-word;color:var(--dsw-alias-label-primary,#1f2328);font-size:14px;line-height:21px}',
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
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
