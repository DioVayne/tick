// Balk bovenaan op een openbare Tick zolang je e-mailadres niet bevestigd is: delen wacht daarop, en zonder bevestiging
// verdwijnt het account na 30 dagen (CONFIG.verifyBy). Met een knop om de bevestigingsmail opnieuw te sturen.
import { request, Offline } from './api.js';
import { t } from './i18n.js';
import { el, toast } from './render.js';
import CONFIG from './settings.js';

/** Tekst van de balk; `verifyBy` is een ISO-tijd of null (dan zonder datum). */
export function verifyBarText(verifyBy, locale) {
  if (!verifyBy) return t('verify.banner_nodate');
  const date = new Date(verifyBy).toLocaleDateString(locale, { day: 'numeric', month: 'long', year: 'numeric' });
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
    el('p', {}, verifyBarText(CONFIG.verifyBy, CONFIG.locale)),
    el('div', { class: 'locbar-actions' }, resend));
  document.getElementById('net')?.after(bar);
}
