import { normLocale, translate } from '../public/i18n.js';

// Stijl en script staan in public/login.css en login.js: de CSP staat geen inline code toe.
export function loginPage(locale: string | undefined): string {
  const lang = normLocale(locale);
  const t = (key: string) => translate(lang, key);
  return `<!doctype html>
<html lang="${lang}"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${t('login.title')}</title><meta name="theme-color" content="#ffffff">
<script src="/theme.js"></script><link rel="stylesheet" href="/login.css">
</head><body>
<form id="f"><h1>Tick</h1>
<input type="password" id="pw" placeholder="${t('login.password')}" autocomplete="current-password" autofocus required>
<button>${t('login.submit')}</button><p id="err" role="alert"></p></form>
<script type="module" src="/login.js"></script></body></html>`;
}

/** Bestanden die de loginpagina zonder inlog nodig heeft. */
export const loginAssets = ['/login.css', '/login.js', '/next.js', '/theme.js'];
