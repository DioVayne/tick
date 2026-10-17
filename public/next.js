// Waar je na het inloggen heen gaat: alleen een pad op deze site, nooit een andere host.
export function safeNext(raw) {
  if (!raw || !raw.startsWith('/') || raw.startsWith('//') || raw.startsWith('/\\')) return '/';
  return raw;
}
