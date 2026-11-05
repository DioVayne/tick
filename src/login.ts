import { normLocale, translate } from '../public/i18n.js';
import { MIN_PASSWORD } from './account';

// Stijl en script staan in public/login.css en login.js: de CSP staat geen inline code toe.
// emptyEmailHint: de beheerder heeft nog geen e-mailadres, dan zegt de pagina dat het veld leeg mag (de overgang).
// deleted: na het verwijderen van je account (/login?deleted=1) staat er een bevestiging boven het formulier.
// forgot: mailen staat aan, dan staat er een link naar /forgot onder het formulier.
export function loginPage(locale: string | undefined, emptyEmailHint = false, deleted = false, forgot = false): string {
  const lang = normLocale(locale);
  const t = (key: string) => translate(lang, key);
  return `<!doctype html>
<html lang="${lang}"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${t('login.title')}</title><meta name="theme-color" content="#ffffff">
<script src="/theme.js"></script><link rel="stylesheet" href="/login.css">
</head><body>
<form id="f"><h1>Tick</h1>${deleted ? `<p class="ok" role="status">${t('login.deleted')}</p>` : ''}
<input type="email" id="email" placeholder="${t('login.email')}" autocomplete="username" autofocus>
<input type="password" id="pw" placeholder="${t('login.password')}" autocomplete="current-password" required>
<button>${t('login.submit')}</button><p id="err" role="alert"></p>${emptyEmailHint ? `<p class="hint">${t('login.empty_email_hint')}</p>` : ''}${forgot ? `<p class="link"><a href="/forgot">${t('login.forgot')}</a></p>` : ''}</form>
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

/**
 * Het contactadres voor de openbare verwijderpagina, uit `ADMIN_CONTACT` (`mailto:…`). Leeg, geen `mailto:` of het
 * voorbeeldadres op example.com uit wrangler.example.jsonc: null, dan noemt de pagina geen adres.
 */
export function contactEmail(adminContact: string | undefined): string | null {
  const m = /^mailto:([^\s@?]+@([^\s@?]+))$/i.exec((adminContact ?? '').trim());
  if (!m || m[2].toLowerCase() === 'example.com') return null;
  return m[1];
}

const escapeHtml = (v: string) => v.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);

/** Openbare pagina (zonder inlog) die uitlegt hoe je je account verwijdert: de link die Google Play vraagt. */
// forgot: mailen staat aan, dan wijst "Kun je niet inloggen?" eerst naar /forgot.
export function deleteAccountPage(locale: string | undefined, contact: string | null, forgot = false): string {
  const lang = normLocale(locale);
  const t = (key: string, vars?: Record<string, string>) => translate(lang, key, vars);
  const mail = contact ? escapeHtml(contact) : '';
  const noLogin = contact ? t('del.no_login', { email: `<a href="mailto:${mail}">${mail}</a>` }) : t('del.no_login_admin');
  return `<!doctype html>
<html lang="${lang}"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${t('del.title')}</title><meta name="theme-color" content="#ffffff">
<script src="/theme.js"></script><link rel="stylesheet" href="/login.css">
</head><body><main class="page">
<h1>${t('del.title')}</h1>
<p>${t('del.intro')}</p>
<h2>${t('del.steps_title')}</h2>
<ol><li>${t('del.step1')}</li><li>${t('del.step2')}</li><li>${t('del.step3')}</li><li>${t('del.step4')}</li></ol>
<h2>${t('del.what_title')}</h2>
<p>${t('del.what')}</p>
<p>${t('del.shared')}</p>
<p>${t('del.retention')}</p>
<p>${t('del.backup')}</p>
<h2>${t('del.some_title')}</h2>
<p>${t('del.some_intro')}</p>
<ul><li>${t('del.some_tasks')}</li><li>${t('del.some_lists')}</li><li>${t('del.some_files')}</li><li>${t('del.some_places')}</li><li>${t('del.some_keys')}</li></ul>
<h2>${t('del.no_login_title')}</h2>
${forgot ? `<p>${t('del.no_login_forgot', { link: `<a href="/forgot">${t('del.forgot_link')}</a>` })}</p>
` : ''}<p>${noLogin}</p>
<p><a href="/privacy">${t('priv.title')}</a> · <a href="/login">${t('del.to_login')}</a></p>
</main></body></html>`;
}

/**
 * Openbare privacypagina (zonder inlog), voor de link die Google Play vraagt. `operator` komt uit `OPERATOR_NAME`
 * (wie deze Tick draait), `contact` uit `ADMIN_CONTACT` via contactEmail; zonder een van beide een algemene zin.
 */
// mailOn: mailen staat aan, dan noemt de pagina Resend bij de diensten.
export function privacyPage(locale: string | undefined, contact: string | null, operator?: string, mailOn = false): string {
  const lang = normLocale(locale);
  const t = (key: string, vars?: Record<string, string>) => translate(lang, key, vars);
  const name = (operator ?? '').trim();
  const who = name ? t('priv.who_named', { name: escapeHtml(name) }) : t('priv.who_unnamed');
  const mail = contact ? escapeHtml(contact) : '';
  const ask = contact ? t('priv.contact', { email: `<a href="mailto:${mail}">${mail}</a>` }) : t('priv.contact_admin');
  const items = (keys: string[]) => `<ul>${keys.map((k) => `<li>${t(k)}</li>`).join('')}</ul>`;
  return `<!doctype html>
<html lang="${lang}"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${t('priv.title')}</title><meta name="theme-color" content="#ffffff">
<script src="/theme.js"></script><link rel="stylesheet" href="/login.css">
</head><body><main class="page">
<h1>${t('priv.title')}</h1>
<p>${t('priv.intro')}</p>
<h2>${t('priv.who_title')}</h2>
<p>${who} ${ask}</p>
<h2>${t('priv.what_title')}</h2>
${items(['priv.what_account', 'priv.what_content', 'priv.what_devices', 'priv.what_push'])}
<h2>${t('priv.location_title')}</h2>
<p>${t('priv.location')}</p>
<h2>${t('priv.not_title')}</h2>
<p>${t('priv.not')}</p>
<p>${t('priv.cookie')}</p>
<h2>${t('priv.others_title')}</h2>
${items(['priv.others_cloudflare', 'priv.others_push', 'priv.others_osm', ...(mailOn ? ['priv.others_mail'] : [])])}
<h2>${t('priv.why_title')}</h2>
<p>${t('priv.why')}</p>
<h2>${t('priv.keep_title')}</h2>
<p>${t('priv.keep')}</p>
<h2>${t('priv.rights_title')}</h2>
<p>${t('priv.rights', { link: `<a href="/delete-account">${t('del.title')}</a>` })}</p>
<p>${t('priv.complaint')}</p>
<p><a href="/login">${t('del.to_login')}</a></p>
</main></body></html>`;
}

/** Pagina "Wachtwoord vergeten?" (/forgot): één e-mailveld; public/forgot.js verstuurt en toont daarna `data-sent`. */
export function forgotPage(locale: string | undefined): string {
  const lang = normLocale(locale);
  const t = (key: string) => translate(lang, key);
  return `<!doctype html>
<html lang="${lang}"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${t('forgot.title')}</title><meta name="theme-color" content="#ffffff">
<script src="/theme.js"></script><link rel="stylesheet" href="/login.css">
</head><body data-sent="${escapeHtml(t('forgot.sent'))}" data-offline="${escapeHtml(t('app.you_are_offline'))}">
<form id="f"><h1>${t('forgot.title')}</h1><p class="intro">${t('forgot.intro')}</p>
<input type="email" id="email" placeholder="${t('login.email')}" autocomplete="username" maxlength="254" required autofocus>
<button>${t('forgot.submit')}</button><p id="err" role="alert"></p>
<p class="link"><a href="/login">${t('forgot.back')}</a></p></form>
<script type="module" src="/forgot.js"></script></body></html>`;
}

/** Bestanden die de loginpagina zonder inlog nodig heeft. */
export const loginAssets = ['/login.css', '/login.js', '/accountlink.js', '/forgot.js', '/next.js', '/theme.js'];
