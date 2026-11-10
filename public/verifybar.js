// Balk bovenaan op een openbare Tick zolang je e-mailadres niet bevestigd is: delen wacht daarop, en zonder bevestiging
// verdwijnt het account na 30 dagen (CONFIG.verifyBy). Met een knop om de bevestigingsmail opnieuw te sturen.
import { request, Offline } from './api.js';
import { getLocale, t } from './i18n.js';
import { el, toast } from './render.js';
import { getTimeZone } from './repeat.js';
import CONFIG from './settings.js';

/** Tekst van de balk; `verifyBy` is een ISO-tijd of null (dan zonder datum). */
export function verifyBarText(verifyBy, locale) {
  if (!verifyBy) return t('verify.banner_nodate');
  const date = new Date(verifyBy).toLocaleDateString(locale, { day: 'numeric', month: 'long', year: 'numeric', timeZone: getTimeZone() });
  return t('verify.banner', { date });
}

export function startVerifyBar() {
  if (!CONFIG.openSignup || CONFIG.emailVerified) return;
  const resend = el('button', {
    type: 'button', class: 'small',
    onclick: async () => {
      resend.disabled = true;
      try {
        await request('POST', '/api/account/verify');
        toast(t('verify.sent'), 'ok');
      } catch (e) {
        toast(e instanceof Offline ? t('app.you_are_offline') : e.message);
        resend.disabled = false;
      }
    },
  }, t('verify.resend'));
  const bar = el('div', { class: 'locbar', role: 'status' },
    el('p', {}, verifyBarText(CONFIG.verifyBy, getLocale())),
    el('div', { class: 'locbar-actions' }, resend));
  document.getElementById('net')?.after(bar);
}

/** Op een openbare Tick deel je alleen via e-mailadres: het invoerveld van de deeldialogen. */
export function recipientField(id, hasChips) {
  const open = !!CONFIG.openSignup;
  const placeholder = open
    ? t(hasChips ? 'share.to_placeholder_email_other' : 'share.to_placeholder_email')
    : t(hasChips ? 'share.to_placeholder_other' : 'share.to_placeholder');
  return el('input', {
    id, type: open ? 'email' : 'text', autocomplete: open ? 'email' : 'off', maxlength: '254', enterkeyhint: 'send', placeholder,
  });
}

/** Placeholder bij een veranderde keuzelijst (de lijstdialoog bouwt die opnieuw op). */
export function recipientPlaceholder(hasChips) {
  return CONFIG.openSignup
    ? t(hasChips ? 'share.to_placeholder_email_other' : 'share.to_placeholder_email')
    : t(hasChips ? 'share.to_placeholder_other' : 'share.to_placeholder');
}

/** Hint boven het deelformulier zolang je adres niet bevestigd is (openbare Tick), anders null. */
export function verifyHint() {
  return CONFIG.openSignup && !CONFIG.emailVerified ? el('p', { class: 'slist-hint', role: 'note' }, t('err.verify_first')) : null;
}
