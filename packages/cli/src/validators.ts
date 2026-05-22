/**
 * Reusable `validate:` callbacks for `@inquirer/prompts.input(...)`.
 * Each returns `true` on success or an error string on failure. The prompt
 * loops until the user provides a value that passes (or cancels with Ctrl+C).
 *
 * The point is to fail at prompt time with a clear message rather than fall
 * through to a vague Zod-parse error at save time.
 */

// Same shape Zod's `.email()` uses. Deliberately permissive — we trust mail
// providers to ultimately bounce malformed addresses; this is a fat-finger
// guard, not RFC 5322 compliance.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// IFSC is India's 11-char bank routing code: 4 letters + '0' + 6 alphanumeric.
// Example: HDFC0001234. Allow whitespace stripping but validate against the
// uppercased value (callers should `.toUpperCase()` before persisting).
const IFSC_RE = /^[A-Z]{4}0[A-Z0-9]{6}$/;

export function validateEmail(allowEmpty: boolean = false) {
  return (value: string): boolean | string => {
    const v = value.trim();
    if (v === '') return allowEmpty ? true : 'Email is required.';
    return EMAIL_RE.test(v) ? true : `"${v}" doesn't look like a valid email.`;
  };
}

export function validateEmailList(allowEmpty: boolean = false) {
  return (value: string): boolean | string => {
    const parts = value
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    if (parts.length === 0) {
      return allowEmpty ? true : 'At least one email is required.';
    }
    const bad = parts.find((p) => !EMAIL_RE.test(p));
    return bad ? `"${bad}" doesn't look like a valid email.` : true;
  };
}

export function validateIfsc(allowEmpty: boolean = true) {
  return (value: string): boolean | string => {
    const v = value.trim().toUpperCase();
    if (v === '') return allowEmpty ? true : 'IFSC is required.';
    return IFSC_RE.test(v)
      ? true
      : 'IFSC should be 11 chars: 4 letters + 0 + 6 alphanumeric (e.g., HDFC0001234).';
  };
}
