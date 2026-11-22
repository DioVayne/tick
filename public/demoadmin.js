// Instellingen → Geavanceerd, alleen voor de beheerder op een Tick met DEMO = "true": de demo zonder account aan/uit
// en hoe lang hij duurt, plus hoeveel er nu lopen (GET/PATCH /api/demo/admin, src/demo.ts).
import { request, Offline } from './api.js';
import { t } from './i18n.js';
import { el, toast } from './render.js';

/** `row` en `seg` zijn de bouwstenen van settingsview.js. Geeft een houder die zich vult zodra de stand binnen is. */
export function demoAdminRow(row, seg) {
  const holder = el('div', {});
  request('GET', '/api/demo/admin').then((s) => {
    const options = [['off', t('set.demo_off')], ...s.choices.map((n) => [String(n), t('set.demo_min', { n })])];
    const pick = seg(t('set.demo'), options, s.on ? String(s.minutes) : 'off', async (v) => {
      try {
        await request('PATCH', '/api/demo/admin', v === 'off' ? { on: false } : { on: true, minutes: Number(v) });
      } catch (e) {
        toast(e instanceof Offline ? t('app.you_are_offline') : e.message);
      }
    });
    const note = `${t('set.demo_note', { url: `${location.origin}/demo`, hours: s.hardHours })} ${t('set.demo_active', { n: s.active, max: s.max })}`;
    holder.replaceChildren(row(t('set.demo'), pick, note));
  }).catch(() => {});
  return holder;
}
