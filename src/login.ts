import { normLocale, translate } from '../public/i18n.js';
import { MIN_PASSWORD } from './account';

// Stijl en script staan in public/login.css en login.js: de CSP staat geen inline code toe.
// emptyEmailHint: de beheerder heeft nog geen e-mailadres, dan zegt de pagina dat het veld leeg mag (de overgang).
// deleted: na het verwijderen van je account (/login?deleted=1) staat er een bevestiging boven het formulier.
// forgot: mailen staat aan, dan staat er een link naar /forgot onder het formulier.
// signup: een openbare Tick (OPEN_SIGNUP): het welkomstscherm, met logo en een link naar /signup.
export function loginPage(locale: string | undefined, emptyEmailHint = false, deleted = false, forgot = false, signup = false): string {
  const lang = normLocale(locale);
  const t = (key: string) => translate(lang, key);
  return `<!doctype html>
<html lang="${lang}"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${t('login.title')}</title><meta name="theme-color" content="#ffffff">
<script src="/theme.js"></script><link rel="stylesheet" href="/login.css">
</head><body>
<form id="f">${signup ? '<img class="logo" src="/icon.svg" alt="" width="64" height="64">' : ''}<h1>Tick</h1>${signup ? `<p class="intro">${t('login.welcome')}</p>` : ''}${deleted ? `<p class="ok" role="status">${t('login.deleted')}</p>` : ''}
<input type="email" id="email" placeholder="${t('login.email')}" autocomplete="username" autofocus>
<input type="password" id="pw" placeholder="${t('login.password')}" autocomplete="current-password" required>
<button>${t('login.submit')}</button><p id="err" role="alert"></p>${emptyEmailHint ? `<p class="hint">${t('login.empty_email_hint')}</p>` : ''}${forgot ? `<p class="link"><a href="/forgot">${t('login.forgot')}</a></p>` : ''}${signup ? `<p class="link">${t('login.no_account')} <a href="/signup">${t('login.signup')}</a></p>` : ''}</form>
<script type="module" src="/login.js"></script></body></html>`;
}

/**
 * Aanmeldpagina (/signup) op een openbare Tick: naam, e-mail, wachtwoord; public/signup.js verstuurt. Met `join` (de
 * link uit een uitnodigingsmail) staat het adres al ingevuld, met wie wat deelt, en gaat inloggen terug naar de link.
 */
export function signupPage(locale: string | undefined, forgot: boolean, join?: { code: string; email: string; name: string; title: string }): string {
  const lang = normLocale(locale);
  const t = (key: string) => translate(lang, key);
  return `<!doctype html>
<html lang="${lang}"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${t('signup.title')}</title><meta name="theme-color" content="#ffffff">
<script src="/theme.js"></script><link rel="stylesheet" href="/login.css">
</head><body data-short="${escapeHtml(translate(lang, 'err.password_short', { min: MIN_PASSWORD }))}" data-offline="${escapeHtml(t('app.you_are_offline'))}"${join ? ` data-join="${escapeHtml(join.code)}"` : ''}>
<form id="f"><img class="logo" src="/icon.svg" alt="" width="64" height="64"><h1>${t('signup.title')}</h1>${join ? `<p class="intro">${escapeHtml(translate(lang, 'join.intro', { name: join.name, title: join.title }))}</p>` : ''}
<input type="text" id="name" placeholder="${t('link.name')}" autocomplete="name" maxlength="60" required autofocus>
<input type="email" id="email" placeholder="${t('login.email')}" autocomplete="username" maxlength="254" required${join ? ` value="${escapeHtml(join.email)}"` : ''}>
<input type="password" id="pw" placeholder="${t('login.password')}" autocomplete="new-password" minlength="${MIN_PASSWORD}" required>
<button>${t('signup.submit')}</button><p id="err" role="alert"></p>
${forgot ? `<p class="link" id="taken" hidden><a href="/forgot">${t('login.forgot')}</a></p>` : ''}
<p class="hint">${t('signup.privacy').replace('{terms}', `<a href="${termsPath(lang)}">${t('terms.link')}</a>`).replace('{link}', `<a href="/privacy">${t('priv.title')}</a>`)}</p>
<p class="link">${t('signup.have_account')} <a href="/login${join ? `?next=${encodeURIComponent('/join/' + join.code)}` : ''}">${t('login.submit')}</a></p></form>
<script type="module" src="/signup.js"></script></body></html>`;
}

/** /join/<code> met een code die niet (meer) werkt. */
export function joinInvalidPage(locale: string | undefined): string {
  const lang = normLocale(locale);
  const t = (key: string) => translate(lang, key);
  return `<!doctype html>
<html lang="${lang}"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${t('join.invalid_title')}</title><meta name="theme-color" content="#ffffff">
<script src="/theme.js"></script><link rel="stylesheet" href="/login.css">
</head><body><div id="f"><img class="logo" src="/icon.svg" alt="" width="64" height="64"><h1>${t('join.invalid_title')}</h1>
<p class="intro">${t('join.invalid')}</p>
<p class="link"><a href="/signup">${t('login.signup')}</a> · <a href="/login">${t('login.submit')}</a></p></div></body></html>`;
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
// open: een openbare Tick (OPEN_SIGNUP): ook uitnodigingen per mail en het opruimen van onbevestigde accounts.
export function privacyPage(locale: string | undefined, contact: string | null, operator?: string, mailOn = false, open = false, calendar = false): string {
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
<p>${t('priv.location')}</p>${calendar ? `
<h2>${t('priv.calendar_title')}</h2>
<p>${t('priv.calendar')}</p>` : ''}
<p>${t('priv.calendar_add')}</p>
<h2>${t('priv.not_title')}</h2>
<p>${t('priv.not')}</p>
<p>${t('priv.cookie')}</p>
<h2>${t('priv.others_title')}</h2>
${items(['priv.others_cloudflare', 'priv.others_push', 'priv.others_osm', ...(mailOn ? ['priv.others_mail'] : []), ...(open ? ['priv.open_invites'] : [])])}
<h2>${t('priv.why_title')}</h2>
<p>${t('priv.why')}</p>
<h2>${t('priv.keep_title')}</h2>
<p>${t('priv.keep')}</p>${open ? `
<p>${t('priv.open_unverified')}</p>
<p>${t('priv.open_reports')}</p>` : ''}
<h2>${t('priv.rights_title')}</h2>
<p>${t('priv.rights', { link: `<a href="/delete-account">${t('del.title')}</a>` })}</p>
<p>${t('priv.complaint')}</p>
<p>${open ? `<a href="${termsPath(lang)}">${t('terms.title')}</a> · ` : ''}<a href="/login">${t('del.to_login')}</a></p>
</main></body></html>`;
}

/** Waar de voorwaarden staan: /voorwaarden in het Nederlands, /terms in het Engels. */
export function termsPath(locale: string | undefined): string {
  return normLocale(locale) === 'nl' ? '/voorwaarden' : '/terms';
}

/** Wie de dienst levert, voor de voorwaarden: naam (OPERATOR_NAME), adres (OPERATOR_ADDRESS) en KvK-nummer (OPERATOR_KVK). */
export type Operator = { name?: string; address?: string; kvk?: string };

/**
 * Algemene voorwaarden (/terms in het Engels, /voorwaarden in het Nederlands), alleen op een openbare Tick. `host` is
 * het adres van deze Tick (zoals app.ticktodo.nl), `contact` komt uit ADMIN_CONTACT via contactEmail.
 */
export function termsPage(locale: string, host: string, contact: string | null, op: Operator = {}): string {
  const lang = normLocale(locale);
  const h = escapeHtml(host);
  const t = (key: string, vars?: Record<string, string>) => translate(lang, key, { host: h, ...vars });
  const name = (op.name ?? '').trim();
  const kvk = (op.kvk ?? '').trim();
  const details = [(op.address ?? '').trim(), kvk ? translate(lang, 'terms.kvk', { kvk }) : ''].filter(Boolean).map(escapeHtml).join(' · ');
  const mail = contact ? escapeHtml(contact) : '';
  const items = (keys: string[]) => `<ul>${keys.map((k) => `<li>${t(k)}</li>`).join('')}</ul>`;
  const lead = (key: string, vars?: Record<string, string>) => `<p><strong>${t(`${key}_lead`)}</strong> ${t(key, vars)}</p>`;
  const page = (path: string) => `<a href="${path}">${h}${path}</a>`;
  const other = lang === 'nl' ? '/terms' : '/voorwaarden';
  return `<!doctype html>
<html lang="${lang}"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${t('terms.title')}</title><meta name="theme-color" content="#ffffff">
<script src="/theme.js"></script><link rel="stylesheet" href="/login.css">
</head><body><main class="page">
<h1>${t('terms.title')}</h1>
<p class="hint">${t('terms.updated')}</p>
<p>${t('terms.intro')}</p>
<h2>${t('terms.who_title')}</h2>
<p>${name ? t('terms.who_named', { name: escapeHtml(name) }) : t('terms.who_unnamed')}</p>${details ? `
<p>${details}</p>` : ''}
<p>${contact ? t('terms.contact', { email: `<a href="mailto:${mail}">${mail}</a>` }) : t('terms.contact_none')}</p>
<h2>${t('terms.what_title')}</h2>
<p>${t('terms.what')}</p>
<p>${t('terms.age')}</p>
<p>${t('terms.open_source')}</p>
<h2>${t('terms.account_title')}</h2>
${items(['terms.account_email', 'terms.account_password', 'terms.account_misuse', 'terms.account_one'])}
<h2>${t('terms.content_title')}</h2>
<p>${t('terms.content_own')}</p>
<p>${t('terms.content_shared')}</p>
<h2>${t('terms.use_title')}</h2>
<p>${t('terms.use_intro')}</p>
${items(['terms.use_law', 'terms.use_harass', 'terms.use_rights', 'terms.use_hack', 'terms.use_overload', 'terms.use_malware'])}
<p>${t('terms.use_report')}</p>
<h2>${t('terms.paid_title')}</h2>
<p>${t('terms.paid_now')}</p>
<p>${t('terms.paid_future')}</p>
${items(['terms.paid_price', 'terms.paid_store', 'terms.paid_cancel', 'terms.paid_free_stays'])}
<p><strong>${t('terms.withdraw_lead')}</strong> ${t('terms.withdraw')}</p>
${items(['terms.withdraw_now', 'terms.withdraw_sub'])}
<p>${t('terms.withdraw_how')}</p>
<h2>${t('terms.ending_title')}</h2>
${lead('terms.avail')}
${lead('terms.remind')}
${lead('terms.change')}
${lead('terms.you', { link: page('/delete-account') })}
${lead('terms.we')}
<h2>${t('terms.liability_title')}</h2>
<p>${t('terms.liab_intro')}</p>
${items(['terms.liab_free', 'terms.liab_paid'])}
<p>${t('terms.liab_except')}</p>
<p>${t('terms.liab_you')}</p>
<h2>${t('terms.privacy_title')}</h2>
<p>${t('terms.privacy', { link: page('/privacy') })}</p>
<h2>${t('terms.changes_title')}</h2>
<p>${t('terms.changes')}</p>
<h2>${t('terms.law_title')}</h2>
<p>${t('terms.law')}</p>
<p>${t('terms.law_court')}</p>
<p>${t('terms.law_rest')}</p>
<p><a href="${other}">${t('terms.other_lang')}</a> · <a href="/privacy">${t('priv.title')}</a> · <a href="/login">${t('del.to_login')}</a></p>
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

/** Pagina achter de bevestigingslink (/verify/:code): bevestigd, of de link werkt niet (meer). */
export function verifyPage(locale: string | undefined, done: boolean): string {
  const lang = normLocale(locale);
  const t = (key: string) => translate(lang, key);
  const title = t(done ? 'verify.done_title' : 'verify.invalid_title');
  return `<!doctype html>
<html lang="${lang}"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${title}</title><meta name="theme-color" content="#ffffff">
<script src="/theme.js"></script><link rel="stylesheet" href="/login.css">
</head><body><div id="f"><img class="logo" src="/icon.svg" alt="" width="64" height="64"><h1>${title}</h1>
<p class="intro">${t(done ? 'verify.done_body' : 'verify.invalid')}</p>
<p class="link"><a href="/">${t('verify.open_app')}</a></p></div></body></html>`;
}

/** Bestanden die de loginpagina zonder inlog nodig heeft. */
export const loginAssets = ['/login.css', '/login.js', '/accountlink.js', '/forgot.js', '/signup.js', '/icon.svg', '/next.js', '/theme.js'];
