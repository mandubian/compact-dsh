// purse.js — a tiny money purse: parsing, arithmetic, splitting.
// v2 (fixed): exact decimal parsing, splits that sum to the total, validated input.

/** Parse a decimal money string ("12.34", "-0.01") into integer cents.
 *  Exact decimal-string arithmetic (no float multiply), half-up on a 3rd decimal.
 *  Throws TypeError on anything that is not a plain decimal amount. */
export function cents(text) {
  const m = String(text).trim().match(/^(-)?(\d+)?(?:\.(\d+))?$/);
  if (!m || (!m[2] && !m[3])) throw new TypeError(`not a money amount: ${JSON.stringify(text)}`);
  let c = (m[2] ? parseInt(m[2], 10) : 0) * 100;
  const frac = m[3] || "";
  c += parseInt((frac.slice(0, 2) + "00").slice(0, 2), 10);
  if (frac[2] >= "5") c += 1; // half-up on the 3rd decimal
  return m[1] ? -c : c;
}

/** Subtract b from a. The purse is spend-first: no overdraft check is v1's documented stance. */
export function take(a, b) {
  return a - b;
}

/** Split total (integer cents) into n equal parts, each a whole number of cents.
 *  The parts always sum exactly to total; the first (total mod n) parts get one extra cent.
 *  Throws TypeError unless total and n are integers and n >= 1. */
export function split(total, n) {
  if (!Number.isInteger(total) || !Number.isInteger(n) || n < 1)
    throw new TypeError(`split needs integer cents and an integer n >= 1, got ${total}, ${n}`);
  const sign = total < 0 ? -1 : 1;
  const base = Math.floor(Math.abs(total) / n);
  const rem = Math.abs(total) % n;
  return Array.from({ length: n }, (_, i) => sign * (base + (i < rem ? 1 : 0)));
}

/** Render integer cents as a decimal string with two places. */
export function display(c) {
  return (c / 100).toFixed(2);
}
