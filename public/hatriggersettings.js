import { request } from './api.js';
import { t } from './i18n.js';
import { el, toast } from './render.js';

// Testfeature "hatrigger" (src/hatrigger.ts): het blok Home Assistant in Instellingen. Bovenaan de koppeling (laatst
// gezien), dan "Deel al mijn triggers", dan per trigger met wie hij gedeeld is. Delen kan alleen met mensen met wie je
// al een lijst of taak deelt; die zien de naam, niet wanneer hij laatst afging. De bouwstenen (row, note, btn, modal,
// ago) komen uit settingsview.js, zodat het blok eruitziet als de andere.

/**
 * @typedef {{ id: string, name: string }} Person
 * @typedef {{ id: string, name: string, last: string | null, share: string[] }} Trig
 * @typedef {{ seen: string | null, stale: boolean, all: boolean, partners: Person[], triggers: Trig[] }} HaSettings
 * @typedef {{
 *   paint: (...nodes: any[]) => void, sub: HTMLElement | undefined, online: boolean,
 *   row: (label: string, control?: any, sub?: string, below?: any) => HTMLElement,
 *   note: (text: string) => HTMLElement,
 *   btn: (label: string, onclick: () => void, o?: { kind?: string, disabled?: boolean }) => HTMLElement,
 *   modal: (o: { title: string, body: any[], buttons: { label: string, value: any, kind?: string }[] }) => Promise<any>,
 *   ago: (iso: string) => string,
 * }} Kit
 */

/** @param {Kit} kit */
export async function paintHaSettings(kit) {
  /** @type {HaSettings} */
  let s;
  try {
    if (!kit.online) throw new Error(t('set.online_only'));
    s = await request('GET', '/api/hatrigger/settings');
  } catch (e) {
    kit.paint(kit.note(/** @type {Error} */ (e).message));
    return;
  }
  draw(kit, s);
}

/** @param {Kit} kit @param {HaSettings} s */
function draw(kit, s) {
  const { row, note, btn } = kit;
  if (kit.sub) kit.sub.textContent = s.triggers.length ? t('hatrigger.settings_sub', { n: String(s.triggers.length) }) : '';
  const names = (ids) => ids.map((id) => s.partners.find((p) => p.id === id)?.name).filter(Boolean).join(', ');

  const save = async (body) => {
    try { draw(kit, await request('PUT', '/api/hatrigger/share', body)); toast(t('set.saved'), 'ok'); } catch (e) { toast(/** @type {Error} */ (e).message); }
  };

  const all = /** @type {HTMLInputElement} */ (el('input', {
    type: 'checkbox', role: 'switch', class: 'set-switch', 'aria-label': t('hatrigger.set_share_all'),
    disabled: !s.partners.length, onchange: () => save({ all: all.checked }),
  }));
  all.checked = s.all;

  const pick = async (trig) => {
    const boxes = s.partners.map((p) => {
      const box = /** @type {HTMLInputElement} */ (el('input', { type: 'checkbox', value: p.id }));
      box.checked = trig.share.includes(p.id);
      return { p, box };
    });
    const ok = await kit.modal({
      title: t('hatrigger.set_share_title', { name: trig.name }),
      body: [el('p', {}, t('hatrigger.set_share_text')),
        ...boxes.map(({ p, box }) => el('label', { class: 'ha-person' }, box, el('span', {}, p.name)))],
      buttons: [{ label: t('set.save'), value: 'ok' }, { label: t('set.cancel'), value: null, kind: 'ghost' }],
    });
    if (ok) save({ per: { [trig.id]: boxes.filter((b) => b.box.checked).map((b) => b.p.id) } });
  };

  const sharing = (trig) => (s.all ? t('hatrigger.set_shared_all')
    : trig.share.length ? t('hatrigger.set_shared_with', { names: names(trig.share) }) : t('hatrigger.set_not_shared'));

  kit.paint(
    row(t('hatrigger.set_connection'), null, s.seen ? t('hatrigger.set_seen', { when: kit.ago(s.seen) }) : t('hatrigger.set_never')),
    s.stale ? note(t('hatrigger.set_stale')) : null,
    s.seen ? null : note(t('hatrigger.set_how')),
    s.triggers.length ? row(t('hatrigger.set_share_all'), all, t('hatrigger.set_share_all_sub')) : null,
    s.triggers.length && !s.partners.length ? note(t('hatrigger.set_no_partners')) : null,
    s.triggers.length ? el('h3', { class: 'set-h3' }, t('hatrigger.set_triggers')) : null,
    ...s.triggers.map((trig) => row(trig.name,
      s.all || !s.partners.length ? null : btn(t('hatrigger.set_share_with'), () => pick(trig), { kind: 'tint' }),
      [trig.last ? t('hatrigger.last', { when: kit.ago(trig.last) }) : t('hatrigger.never'), sharing(trig)].join(' · '))),
    s.seen && !s.triggers.length ? note(t('hatrigger.set_none')) : null,
  );
}
