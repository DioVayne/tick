// Waar je na het inloggen heen gaat: alleen een pad op deze site, nooit een andere host.
// Stuurtekens (ook tab, LF en CR, die de browser uit een URL haalt) en backslashes worden geweigerd.
export function safeNext(raw) {
  if (!raw || !raw.startsWith('/') || raw.startsWith('//') || /[\u0000-\u001f\u007f\\]/.test(raw)) return '/';
  return raw;
}
