// Canonical JSON — the serialization signatures are computed over.
//
// THE CANONICALIZATION IS THE SECURITY, and it is the same rule the record
// chain already runs on: object keys sorted at every depth, arrays kept in
// order, no whitespace. Two renderings of the same artifact must produce the
// same bytes or a signature is over "whatever JSON.stringify felt like that
// day"; one authority here, re-exported by the record package, so artifact
// signatures and chain links can never disagree about what canonical means.

/**
 * Deterministic JSON: object keys sorted at every depth, arrays kept in order.
 */
export function canonicalJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map(k => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(',')}}`;
}

/** The exact bytes a signature over `value` covers. */
export function canonicalBytes(value) {
  return Buffer.from(canonicalJson(value), 'utf8');
}

/**
 * A copy of `value` without the named field, for computing the signed form of
 * an artifact that carries its own signature.
 */
export function withoutField(value, field) {
  const { [field]: _, ...rest } = value;
  return rest;
}
