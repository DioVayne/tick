import { normLocale, translate } from '../public/i18n.js';
import { MIN_PASSWORD } from './account';

// Stijl en script staan in public/login.css en login.js: de CSP staat geen inline code toe.
// emptyEmailHint: de beheerder heeft nog geen e-mailadres, dan zegt de pagina dat het veld leeg mag (de overgang).
export function loginPage(locale: string | undefined, emptyEmailHint = false): string {
  const lang = normLocale(locale);
  const t = (key: string) => translate(lang, key);
  return `<!doctype html>
<html lang="${lang}"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${t('login.title')}</title><meta name="theme-color" content="#ffffff">
<script src="/theme.js"></script><link rel="stylesheet" href="/login.css">
</head><body>
<form id="f"><h1>Tick</h1>
<input type="email" id="email" placeholder="${t('login.email')}" autocomplete="username" autofocus>
<input type="password" id="pw" placeholder="${t('login.password')}" autocomplete="current-password" required>
<button>${t('login.submit')}</button><p id="err" role="alert"></p>${emptyEmailHint ? `<p class="hint">${t('login.empty_email_hint')}</p>` : ''}</form>
<script type="module" src="/login.js"></script></body></html>`;
}

/** Pagina achter een uitnodigings- of resetlink; een ongeldige link toont alleen de melding. */
export function linkPage(locale: string | undefined, kind: 'invite' | 'reset', valid: boolean): string {
  const lang = normLocale(locale);
  const t = (key: string) => translate(lang, key);
  const title = t(kind === 'invite' ? 'link.invite_title' : 'link.reset_title');
  const content = !valid
    ? `<div id="f"><h1>Tick</h1><p id="err" role="alert">${t('link.invalid')}</p></div>`
    : `<form id="f"><h1>${title}</h1>
${kind === 'invite' ? `<input type="text" id="name" placeholder="${t('link.name')}" autocomplete="name" maxlength="60" required autofocus>
<input type="email" id="email" placeholder="${t('login.email')}" autocomplete="username" maxlength="254" required>
` : ''}<input type="password" id="pw" placeholder="${t('login.password')}" autocomplete="new-password" required>
<button>${t(kind === 'invite' ? 'link.invite_submit' : 'link.reset_submit')}</button><p id="err" role="alert"></p></form>
<script type="module" src="/accountlink.js"></script>`;
  // data-short: de melding voor de controle in de browser, in de taal van de pagina.
  return `<!doctype html>
<html lang="${lang}"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${title}</title><meta name="theme-color" content="#ffffff">
<script src="/theme.js"></script><link rel="stylesheet" href="/login.css">
</head><body data-kind="${kind}" data-short="${translate(lang, 'err.password_short', { min: MIN_PASSWORD })}">
${content}</body></html>`;
}

/** Bestanden die de loginpagina zonder inlog nodig heeft. */
export const loginAssets = ['/login.css', '/login.js', '/accountlink.js', '/next.js', '/theme.js'];
