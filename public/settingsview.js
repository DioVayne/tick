// Instellingenpagina: een eigen weergave in de middenkolom (#main), met een eigen stap in de geschiedenis zodat
// terug (ook de Android-terugknop) en Esc hem sluiten. 📱-delen gelden voor dit apparaat en werken offline;
// 🏠-delen gelden voor de hele installatie en tonen offline de laatst bekende waarde, uitgeschakeld.
import { Offline, request } from './api.js';
import { isInApp, openPhoneSettings } from './androidapp.js';
import { ask } from './dialog.js';
import { dateLocale, t } from './i18n.js';
import { disablePush, enablePush, pushState, resubscribeLocale } from './push.js';
import { setDefaultTime, setTimeZone, setWeekStart } from './repeat.js';
import { $, el, render, toast } from './render.js';
import CONFIG, { setLanguage } from './settings.js';
import { closeDrawer } from './sidebar.js';
import { load } from './store.js';

const CACHE_KEY = 'tick.settings-cache';
const RECENT_MS = 7 * 86_400_000;
const MIN_PASSWORD = 8;
// Noodroute als het wachtwoord kwijt is (staat ook in SETUP.md); een commando, geen tekst om te vertalen.
const RESCUE = `npx wrangler d1 execute DB --remote --command "UPDATE users SET password_hash = NULL WHERE role = 'admin'"`;
const ENV_SECRET = { 'env-api': 'API_TOKEN', 'env-inbox': 'INBOX_TOKEN' };

/** @typedef {{ timeZone: string, reminderTime: string, weekStart: 'mon' | 'sun', defaultLocale: 'en' | 'nl', fallbackWebhook: string | null, fallbackFromEnv: boolean, fallbackOverride: boolean, fallbackEnvSet: boolean }} Settings */

const S = {
  open: false,
  /** @type {HTMLElement | null} */ root: null,
  /** @type {Settings | null} */ settings: null,
  online: false,
  loaded: false, // de eerste poging om de instellingen op te halen is klaar
  /** @type {ServiceWorkerRegistration | null} */ reg: null,
  /** @type {Record<string, HTMLElement>} */ parts: {},
};

// ---------- kleine hulpjes ----------

const storeGet = (key) => { try { return localStorage.getItem(key); } catch { return null; } };
const storeSet = (key, value) => {
  try { if (value === null) localStorage.removeItem(key); else localStorage.setItem(key, value); } catch { /* geen opslag */ }
};

const fmtDate = (iso) => new Date(iso).toLocaleDateString(dateLocale(), { day: 'numeric', month: 'short', year: 'numeric' });
const fmtNum = (n) => Number(n).toLocaleString(dateLocale());

/** "3 minuten geleden", "gisteren"; ouder dan een maand: de datum. */
function ago(iso) {
  const s = (Date.parse(iso) - Date.now()) / 1000;
  const a = Math.abs(s);
  const rtf = new Intl.RelativeTimeFormat(dateLocale(), { numeric: 'auto' });
  if (a < 3600) return rtf.format(Math.round(s / 60) || 0, 'minute');
  if (a < 86_400) return rtf.format(Math.round(s / 3600), 'hour');
  if (a < 30 * 86_400) return rtf.format(Math.round(s / 86_400), 'day');
  return fmtDate(iso);
}

const recent = (iso) => !!iso && Date.now() - Date.parse(iso) < RECENT_MS;
const offlineText = (e) => (e instanceof Offline ? t('set.online_only') : e.message);

/**
 * Korte naam voor een browser uit zijn user-agent, bijvoorbeeld "Chrome op Windows". Heuristiek, geen garantie.
 * @param {string} userAgent
 */
export function deviceName(userAgent) {
  const ua = String(userAgent || '');
  const browser = /Edg(e|A|iOS)?\//.test(ua) ? 'Edge'
    : /OPR\/|Opera/.test(ua) ? 'Opera'
    : /SamsungBrowser/.test(ua) ? 'Samsung Internet'
    : /Firefox\/|FxiOS/.test(ua) ? 'Firefox'
    : /Chrome\/|CriOS/.test(ua) ? 'Chrome'
    : /Safari\//.test(ua) ? 'Safari'
    : '';
  const os = /Android/.test(ua) ? 'Android'
    : /iPhone|iPod/.test(ua) ? 'iPhone'
    : /iPad/.test(ua) ? 'iPad'
    : /Windows/.test(ua) ? 'Windows'
    : /CrOS/.test(ua) ? 'ChromeOS'
    : /Mac OS X|Macintosh/.test(ua) ? 'macOS'
    : /Linux/.test(ua) ? 'Linux'
    : '';
  if (browser && os) return t('set.device_name', { browser, os });
  return browser || os || t('set.browser_unknown');
}

/** De statusbalk van de PWA kleurt mee met de achtergrond. */
function syncThemeColor() {
  const meta = /** @type {HTMLMetaElement | null} */ ($('meta[name="theme-color"]'));
  if (meta) meta.content = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
}
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', syncThemeColor);
syncThemeColor();

const getReg = () => ('serviceWorker' in navigator
  ? navigator.serviceWorker.getRegistration().then((r) => r ?? null).catch(() => null)
  : Promise.resolve(null));

// ---------- bouwstenen ----------

const note = (text) => el('small', { class: 'set-note' }, text);

/** Een regel: links de omschrijving (met eventueel een toelichting), rechts de bediening. */
const row = (label, control, sub) => el('div', { class: 'set-row' },
  el('div', { class: 'set-label' }, label || null, sub ? note(sub) : null),
  control ? el('div', { class: 'set-control' }, control) : null);

const btn = (label, onclick, { kind = 'ghost', disabled = false } = {}) =>
  el('button', { type: 'button', class: `set-btn ${kind}`, disabled, onclick }, label);

/** Knoppenrij waarvan er één gekozen is. */
function seg(label, options, current, onPick, disabled = false) {
  const wrap = el('div', { class: 'set-seg', role: 'group', 'aria-label': label });
  for (const [value, text] of options) {
    const b = el('button', {
      type: 'button', 'aria-pressed': String(value === current), disabled,
      onclick: () => {
        for (const x of wrap.children) x.setAttribute('aria-pressed', String(x === b));
        onPick(value);
      },
    }, text);
    wrap.append(b);
  }
  return wrap;
}

function select(label, options, current, onChange, disabled = false) {
  const s = /** @type {HTMLSelectElement} */ (el('select', { class: 'set-select', 'aria-label': label, disabled, onchange: () => onChange(s.value) },
    ...options.map(([value, text]) => el('option', { value, selected: value === current }, text))));
  return s;
}

/** Een blok met icoon en titel; de inhoud staat in een eigen deel dat apart opnieuw getekend kan worden. */
function block(icon, title, part, sub) {
  const body = el('div', { class: 'set-body' });
  S.parts[part] = body;
  return el('section', { class: 'set-block', 'aria-labelledby': `set-h-${part}` },
    el('h2', { id: `set-h-${part}` }, el('span', { class: 'set-icon', 'aria-hidden': 'true' }, icon), title, sub ? el('span', { class: 'set-sub' }, sub) : null),
    body);
}

const paint = (part, ...nodes) => S.parts[part]?.replaceChildren(...nodes.flat().filter(Boolean));

/**
 * Dialoog met eigen inhoud (zelfde vorm als ask in dialog.js). Een knop-value die een functie is, wordt bij het
 * klikken uitgerekend; geeft die undefined, dan blijft de dialoog open. Enter in een invoerveld kiest de eerste knop.
 */
function modal({ title, body, buttons }) {
  return new Promise((resolve) => {
    let settled = false;
    const pick = (b) => {
      const value = typeof b.value === 'function' ? b.value() : b.value;
      if (value !== undefined) finish(value);
    };
    const finish = (value) => {
      if (settled) return;
      settled = true;
      if (dialog.open) dialog.close();
      dialog.remove();
      resolve(value);
    };
    const dialog = /** @type {HTMLDialogElement} */ (el('dialog', { class: 'dialog', 'aria-labelledby': 'dialog-title' },
      el('h2', { id: 'dialog-title' }, title),
      ...body,
      el('div', { class: 'dialog-buttons' }, ...buttons.map((b) => el('button', {
        type: 'button', class: b.kind === 'danger' ? 'danger' : b.kind === 'ghost' ? 'ghost' : '', onclick: () => pick(b),
      }, b.label)))));
    dialog.addEventListener('click', (e) => { if (e.target === dialog) finish(null); });
    dialog.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') e.stopPropagation();
      if (e.key === 'Enter' && e.target instanceof HTMLInputElement) { e.preventDefault(); pick(buttons[0]); }
    });
    dialog.addEventListener('close', () => finish(null));
    document.body.append(dialog);
    dialog.showModal();
    /** @type {HTMLElement | null} */ (dialog.querySelector('input, select, button'))?.focus();
  });
}

async function copy(text, node) {
  try {
    await navigator.clipboard.writeText(text);
    toast(t('set.copied'), 'ok');
  } catch {
    // Geen klembord (bijvoorbeeld zonder https): selecteer de tekst zodat je hem zelf kunt kopiëren.
    const range = document.createRange();
    range.selectNodeContents(node);
    getSelection()?.removeAllRanges();
    getSelection()?.addRange(range);
    toast(t('set.copy_failed'));
  }
}

/** Een waarde met een Kopieer-knop ernaast. */
function secret(label, value) {
  const code = el('code', {}, value);
  return el('div', { class: 'set-secret' }, el('span', { class: 'set-secret-label' }, label), code,
    el('button', { type: 'button', class: 'set-btn', onclick: () => copy(value, code) }, t('set.copy')));
}

// ---------- instellingen van de installatie ----------

function setSettings(s) {
  S.settings = s;
  S.online = true;
  // De URL uit de installatie is een secret: die komt niet in de cache.
  storeSet(CACHE_KEY, JSON.stringify(s.fallbackFromEnv ? { ...s, fallbackWebhook: null } : s));
}

/** Laatst bekende instellingen (cache), anders de waarden uit /config.js. */
function cachedSettings() {
  try {
    const c = JSON.parse(storeGet(CACHE_KEY) ?? 'null');
    if (c && typeof c === 'object' && typeof c.timeZone === 'string') return c;
  } catch { /* kapotte cache */ }
  return { timeZone: CONFIG.timeZone, reminderTime: CONFIG.reminderTime, weekStart: CONFIG.weekStart, defaultLocale: CONFIG.defaultLocale, fallbackWebhook: null, fallbackFromEnv: false, fallbackOverride: false, fallbackEnvSet: false };
}

async function fetchSettings() {
  try {
    setSettings(await request('GET', '/api/settings'));
  } catch (e) {
    S.online = false;
    S.settings = cachedSettings();
    if (!(e instanceof Offline)) toast(t('set.load_failed', { reason: e.message }));
  }
  S.loaded = true;
}

/** Toelichting bij een 🏠-veld: offline "Alleen online te wijzigen"; tijdens het laden niets. */
const homeNote = (text = null) => (!S.online ? (S.loaded ? t('set.online_only') : null) : text);

/**
 * Wijziging naar de server; geeft de nieuwe instellingen of null. Bij een fout zet `revert` alleen dat ene veld
 * terug; de rest (een half ingevuld formulier, het webhookveld) blijft staan.
 */
async function save(patch, revert) {
  try {
    const s = await request('PATCH', '/api/settings', patch);
    setSettings(s);
    toast(t('set.saved'), 'ok');
    return s;
  } catch (e) {
    if (e instanceof Offline) S.online = false;
    toast(t('set.save_failed', { reason: offlineText(e) }));
    revert?.();
    return null;
  }
}

/** Alles wat van de server of de installatie afhangt opnieuw tekenen. */
function paintHome() {
  paintLangTime();
  paintAccount();
  paintData();
  paintAdvanced();
}

// ---------- 🎨 Weergave ----------

const DISPLAY = {
  theme: { key: 'tick.theme', def: 'auto' },
  font: { key: 'tick.font', def: 'm' },
  density: { key: 'tick.density', def: 'normal' },
};

/** Direct toepassen op <html> en bewaren; de standaardwaarde wist de keuze (Normaal volgt de lettergrootte van de browser). */
function setDisplay(attr, value) {
  const { key, def } = DISPLAY[attr];
  const root = document.documentElement;
  if (value === def) delete root.dataset[attr];
  else root.dataset[attr] = value;
  storeSet(key, value === def ? null : value);
  if (attr === 'theme') syncThemeColor();
}

function displayBlock() {
  const ds = document.documentElement.dataset;
  const sec = block('🎨', t('set.display'), 'display', t('set.this_device'));
  const preview = el('ul', { class: 'tasks set-preview', 'aria-hidden': 'true' },
    ...['set.preview_task', 'set.preview_task2'].map((k) => el('li', { class: 'task' },
      el('div', { class: 'row' }, el('span', { class: 'check' }), el('span', { class: 'title' }, t(k))))));
  paint('display',
    row(t('set.theme'), seg(t('set.theme'), [['auto', t('set.theme_auto')], ['light', t('set.theme_light')], ['dark', t('set.theme_dark')]],
      ds.theme ?? 'auto', (v) => setDisplay('theme', v))),
    row(t('set.font'), seg(t('set.font'), [['s', t('set.font_s')], ['m', t('set.font_m')], ['l', t('set.font_l')], ['xl', t('set.font_xl')]],
      ds.font ?? 'm', (v) => setDisplay('font', v))),
    row(t('set.density'), seg(t('set.density'), [['compact', t('set.density_compact')], ['normal', t('set.density_normal')], ['roomy', t('set.density_roomy')]],
      ds.density ?? 'normal', (v) => setDisplay('density', v))),
    preview);
  return sec;
}

// ---------- 🌍 Taal en tijd ----------

async function changeLanguage(value) {
  setLanguage(value === 'auto' ? null : value);
  // Meldingen komen in de taal van het abonnement: dat eerst bijwerken (offline lukt dat niet, dan bij de volgende keer).
  // De registratie zelf ophalen: S.reg kan bij een snelle keuze nog leeg zijn.
  try { await resubscribeLocale(S.reg ?? await getReg()); } catch { /* offline */ }
  location.reload();
}

function zones(current) {
  let list = [];
  try { list = Intl.supportedValuesOf('timeZone'); } catch { /* oude browser */ }
  return list.includes(current) ? list : [current, ...list];
}

/** De laatst opgeslagen instellingen: daar gaat een veld naartoe terug als opslaan mislukt. */
const current = () => S.settings ?? cachedSettings();

function paintLangTime() {
  const s = current();
  const off = !S.online;
  const lang = storeGet('tick.lang');
  // Eén wissel tegelijk: tijdens het opslaan staan de keuze en de knop uit, anders kan de server de taken dubbel verschuiven.
  const tz = select(t('set.timezone'), zones(s.timeZone).map((z) => [z, z]), s.timeZone, async (v) => {
    tz.disabled = fromDevice.disabled = true;
    try {
      if (!(await save({ timeZone: v }, () => { tz.value = current().timeZone; }))) return;
      setTimeZone(v);
      load();
    } finally {
      tz.disabled = fromDevice.disabled = !S.online;
    }
  }, off);
  const fromDevice = btn(t('set.timezone_device'), () => {
    const z = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (!z || z === tz.value || tz.disabled) return;
    if (![...tz.options].some((o) => o.value === z)) tz.append(el('option', { value: z }, z));
    tz.value = z;
    tz.dispatchEvent(new Event('change'));
  }, { disabled: off });
  const time = /** @type {HTMLInputElement} */ (el('input', { type: 'time', class: 'set-time', value: s.reminderTime, required: true, disabled: off, 'aria-label': t('set.reminder_time') }));
  time.addEventListener('change', async () => {
    if (!time.value) return;
    if (await save({ reminderTime: time.value }, () => { time.value = current().reminderTime; })) setDefaultTime(time.value);
  });
  const week = seg(t('set.week_start'), [['mon', t('set.week_mon')], ['sun', t('set.week_sun')]], s.weekStart, async (v) => {
    const revert = () => [...week.children].forEach((b, i) => b.setAttribute('aria-pressed', String((i === 1) === (current().weekStart === 'sun'))));
    if (await save({ weekStart: v }, revert)) setWeekStart(v);
  }, off);
  paint('langtime',
    row(t('set.language'), select(t('set.language'), [['auto', t('set.lang_auto')], ['en', t('set.lang_en')], ['nl', t('set.lang_nl')]], lang ?? 'auto', changeLanguage),
      t('set.this_device')),
    row(t('set.timezone'), [tz, fromDevice], homeNote()),
    row(t('set.reminder_time'), time, homeNote(t('set.reminder_time_note'))),
    row(t('set.week_start'), week, homeNote()));
}

// ---------- 🔔 Meldingen ----------

async function paintPush() {
  const ps = await pushState(S.reg);
  const sw = /** @type {HTMLInputElement} */ (el('input', {
    type: 'checkbox', role: 'switch', class: 'set-switch', 'aria-label': t('set.push_label'),
    disabled: !ps.supported || ps.permission === 'denied',
  }));
  sw.checked = ps.subscribed && ps.permission === 'granted';
  sw.addEventListener('change', async () => {
    sw.disabled = true;
    try {
      if (sw.checked) {
        await enablePush(S.reg);
        const r = await request('POST', '/api/push/test', {});
        if (r.ok) toast(t('set.push_on_test'), 'ok'); else toast(t('push.enabled_test_missing'));
      } else {
        await disablePush(S.reg);
        toast(t('set.push_off'), 'ok');
      }
    } catch (e) { toast(t('push.setup_failed', { reason: e.message })); }
    paintPush();
    paintDevices();
  });
  const test = btn(t('set.push_test'), async () => {
    try {
      const r = await request('POST', '/api/push/test', {});
      if (r.ok) toast(t('set.push_test_sent'), 'ok'); else toast(t('push.enabled_test_missing'));
    } catch (e) { toast(offlineText(e)); }
  }, { disabled: !sw.checked });
  paint('push',
    row(t('set.push_label'), sw, t('set.this_device')),
    row('', test),
    ps.iosNeedsHomeScreen ? el('p', { class: 'hint' }, t('push.ios_hint'))
      : !ps.supported ? el('p', { class: 'hint' }, t('push.unsupported'))
      : ps.permission === 'denied' ? el('p', { class: 'hint' }, t('set.push_blocked')) : null);
}

// ---------- 📱 Apparaten ----------

function thisBrowserRow(ps) {
  const ok = ps.supported && ps.permission === 'granted' && ps.subscribed;
  const fix = ok ? null
    : ps.iosNeedsHomeScreen ? t('set.fix_ios')
    : !ps.supported ? t('push.unsupported')
    : ps.permission === 'denied' ? t('set.push_blocked')
    : t('set.fix_push_off');
  return row(`${ok ? '✅' : '⚠️'} ${t('set.this_browser')}`, null, ok ? t('set.push_works') : fix);
}

function phoneRow(p) {
  const st = p.status;
  const name = (p.name ?? t('set.phone_install')) + (st?.name ? ` (${st.name})` : '');
  const seenAt = st?.seen_at ?? p.last_used_at;
  const seen = seenAt ? t('set.seen', { when: ago(seenAt) }) : t('set.never_seen');
  if (!st) return row(`📱 ${name}`, null, `${seen} · ${t('set.status_needs_app')}`);
  const where = { always: t('set.loc_always'), foreground: t('set.loc_foreground'), off: t('set.loc_off') }[st.location] ?? st.location;
  const details = [seen, st.notifications ? t('set.notif_on') : t('set.notif_off'), t('set.location', { value: where }),
    st.app_version ? t('set.app_version', { version: st.app_version }) : null].filter(Boolean).join(' · ');
  const problems = [st.location !== 'always' ? t('set.fix_location') : null, !st.notifications ? t('set.fix_notifications') : null].filter(Boolean);
  return [row(`${problems.length ? '⚠️' : '✅'} ${name}`, null, details), ...problems.map((x) => el('p', { class: 'hint' }, x))];
}

function browserRow(b) {
  return row(`💻 ${deviceName(b.user_agent)}`, btn(t('set.remove'), async () => {
    const yes = await ask({ title: t('set.remove_browser_title'), text: t('set.remove_browser_text'), buttons: [
      { label: t('set.remove'), value: 'yes', kind: 'danger' }, { label: t('set.cancel'), value: null, kind: 'ghost' }] });
    if (!yes) return;
    try {
      await request('DELETE', '/api/push/subscribe', { endpoint: b.endpoint });
      paintDevices();
    } catch (e) { toast(offlineText(e)); }
  }, { kind: 'danger', disabled: !S.online }), t('set.signed_up', { date: fmtDate(b.created_at) }));
}

async function paintDevices() {
  const ps = await pushState(S.reg);
  const mine = ps.subscribed ? (await S.reg?.pushManager.getSubscription().catch(() => null))?.endpoint : null;
  const pair = btn(t('set.pair'), pairPhone, { kind: '', disabled: !S.online });
  let rest;
  try {
    const d = await request('GET', '/api/devices');
    const others = d.browsers.filter((b) => b.endpoint !== mine);
    rest = [
      others.length ? el('h3', { class: 'set-h3' }, t('set.other_browsers')) : null,
      ...others.map(browserRow),
      el('h3', { class: 'set-h3' }, t('set.phones')),
      ...(d.phones.length ? d.phones.flatMap(phoneRow) : [note(t('set.no_phones'))]),
    ];
  } catch (e) {
    rest = [note(offlineText(e))];
  }
  if (!S.open) return;
  const phoneSettings = isInApp() && CONFIG.androidPackage ? row('', btn(t('set.phone_settings'), openPhoneSettings), null) : null;
  paint('devices', thisBrowserRow(ps), ...rest, phoneSettings, row('', pair, t('set.pair_note')));
}

/** Vraagt een naam (en eventueel de soort) voor een nieuwe sleutel; null bij annuleren. */
async function askKey({ title, text, withKind }) {
  const name = /** @type {HTMLInputElement} */ (el('input', { type: 'text', maxlength: '100', placeholder: t('set.key_name_placeholder'), 'aria-label': t('set.key_name') }));
  const kind = /** @type {HTMLSelectElement} */ (select(t('set.key_kind'), [['full', t('set.kind_full')], ['inbox', t('set.kind_inbox')]], 'full', () => {}));
  const result = await modal({
    title,
    body: [el('p', {}, text), el('label', { class: 'set-field' }, t('set.key_name'), name),
      withKind ? el('label', { class: 'set-field' }, t('set.key_kind'), kind) : null].filter(Boolean),
    // Zonder naam blijft de dialoog open, met de focus in het veld.
    buttons: [{ label: t('set.create'), value: () => name.value.trim() || (name.focus(), undefined) }, { label: t('set.cancel'), value: null, kind: 'ghost' }],
  });
  return result ? { name: result, kind: withKind ? kind.value : 'full' } : null;
}

async function createKey(name, kind) {
  try {
    return await request('POST', '/api/keys', { name, kind });
  } catch (e) {
    toast(t('set.key_failed', { reason: offlineText(e) }));
    return null;
  }
}

async function pairPhone() {
  const answer = await askKey({ title: t('set.pair_title'), text: t('set.pair_name_text'), withKind: false });
  if (!answer) return;
  const key = await createKey(answer.name, 'full');
  if (!key) return;
  await modal({
    title: t('set.pair_title'),
    body: [el('p', {}, t('set.key_once', { name: key.name })),
      secret(t('set.address'), location.origin), secret(t('set.key'), key.key),
      el('ol', { class: 'set-steps' }, el('li', {}, t('set.pair_step1')), el('li', {}, t('set.pair_step2')), el('li', {}, t('set.pair_step3')))],
    buttons: [{ label: t('set.done'), value: 'ok' }],
  });
  paintDevices();
  paintKeys();
}

// ---------- 👤 Account ----------

const field = (label, input) => el('label', { class: 'set-field' }, label, input);

function passwordForm() {
  const input = (auto) => /** @type {HTMLInputElement} */ (el('input', { type: 'password', autocomplete: auto, required: true }));
  const cur = input('current-password');
  const next = input('new-password');
  const again = input('new-password');
  next.minLength = MIN_PASSWORD;
  const form = /** @type {HTMLFormElement} */ (el('form', { class: 'set-form', hidden: true },
    field(t('set.pw_current'), cur), field(t('set.pw_new'), next), field(t('set.pw_again'), again),
    el('div', {}, el('button', { type: 'submit', class: 'set-btn' }, t('set.save'))),
    el('p', { class: 'set-note' }, t('set.pw_rescue'), ' ', el('code', {}, RESCUE))));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (next.value.length < MIN_PASSWORD) { toast(t('err.password_short', { min: MIN_PASSWORD })); return; }
    if (next.value !== again.value) { toast(t('set.pw_mismatch')); return; }
    try {
      await request('POST', '/api/account/password', { current: cur.value, next: next.value });
      form.reset();
      form.hidden = true;
      toast(t('set.pw_changed'), 'ok');
    } catch (err) { toast(offlineText(err)); }
  });
  return form;
}

async function logout() {
  try {
    const res = await fetch('/logout', { method: 'POST' });
    if (!res.ok) throw new Error(res.statusText);
    location.href = '/login';
  } catch (e) { toast(t('app.logout_failed', { reason: navigator.onLine === false ? t('app.you_are_offline') : e.message })); }
}

function paintAccount() {
  const off = !S.online;
  const form = passwordForm();
  paint('account',
    row(t('set.password'), btn(t('set.change'), () => { form.hidden = !form.hidden; if (!form.hidden) form.querySelector('input')?.focus(); }, { disabled: off }),
      homeNote()),
    form,
    row(t('set.logout_others'), btn(t('set.logout_others_button'), async () => {
      const yes = await ask({ title: t('set.logout_others'), text: t('set.logout_others_note'), buttons: [
        { label: t('set.logout_others_button'), value: 'yes', kind: 'danger' }, { label: t('set.cancel'), value: null, kind: 'ghost' }] });
      if (!yes) return;
      try {
        await request('POST', '/api/account/logout-others', {});
        toast(t('set.logout_others_done'), 'ok');
      } catch (e) { toast(offlineText(e)); }
    }, { disabled: off }), t('set.logout_others_note')),
    row(t('set.logout_here'), btn(t('ui.logout'), logout)));
}

// ---------- 💾 Gegevens ----------

/** Laat een verborgen bestandskiezer een bestand kiezen; geeft de tekst of null. */
function pickFile(accept) {
  return new Promise((resolve) => {
    const input = /** @type {HTMLInputElement} */ (el('input', { type: 'file', accept, hidden: true }));
    input.addEventListener('change', async () => {
      const file = input.files?.[0];
      input.remove();
      resolve(file ? await file.text() : null);
    });
    input.addEventListener('cancel', () => { input.remove(); resolve(null); });
    S.root?.append(input);
    input.click();
  });
}

async function downloadBackup() {
  try {
    let res;
    try { res = await fetch('/api/export'); } catch { throw new Offline(t('set.online_only')); }
    if (res.status === 401) { location.href = '/login'; return; }
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || res.statusText);
    const name = /filename="([^"]+)"/.exec(res.headers.get('content-disposition') ?? '')?.[1] ?? 'tick-backup.json';
    const url = URL.createObjectURL(await res.blob());
    const a = el('a', { href: url, download: name, hidden: true });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  } catch (e) { toast(t('set.backup_failed', { reason: offlineText(e) })); }
}

async function restoreBackup() {
  const text = await pickFile('.json,application/json');
  if (text === null) return;
  let data;
  try { data = JSON.parse(text); } catch { data = null; }
  if (!data || data.app !== 'tick' || !Array.isArray(data.tasks)) { toast(t('err.backup_invalid')); return; }
  const places = Array.isArray(data.places) ? data.places.length : 0;
  const date = typeof data.exported_at === 'string' && !Number.isNaN(Date.parse(data.exported_at)) ? fmtDate(data.exported_at) : '?';
  const yes = await ask({
    title: t('set.restore_title'),
    text: `${t('set.restore_contents', { tasks: fmtNum(data.tasks.length), places: fmtNum(places), date })} ${t('set.restore_merge')}`,
    buttons: [{ label: t('set.restore_button'), value: 'yes' }, { label: t('set.cancel'), value: null, kind: 'ghost' }],
  });
  if (!yes) return;
  try {
    const r = await request('POST', '/api/import/backup', data);
    toast(t('set.restore_done', { tasks: fmtNum(r.tasks), places: fmtNum(r.places), skipped: fmtNum(r.skipped) }), 'ok');
    load();
  } catch (e) { toast(t('set.restore_failed', { reason: offlineText(e) })); }
}

async function importTickTick() {
  const text = await pickFile('.csv,text/csv');
  if (text === null) return;
  try {
    let res;
    try {
      res = await fetch('/api/import/ticktick', { method: 'POST', headers: { 'content-type': 'text/csv' }, body: text });
    } catch { throw new Offline(t('set.online_only')); }
    if (res.status === 401) { location.href = '/login'; return; }
    const r = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(r.error || res.statusText);
    toast(t('set.ticktick_done', { added: fmtNum(r.added), existing: fmtNum(r.existing), skipped: fmtNum(r.skipped) }), 'ok');
    load();
  } catch (e) { toast(t('set.ticktick_failed', { reason: offlineText(e) })); }
}

function paintData() {
  const off = !S.online;
  paint('data',
    row(t('set.backup'), btn(t('set.download'), downloadBackup, { disabled: off }), homeNote(t('set.backup_note'))),
    row(t('set.restore'), btn(t('set.choose_file'), restoreBackup, { disabled: off }), homeNote(t('set.restore_note'))),
    row(t('set.ticktick'), btn(t('set.import_csv'), importTickTick, { disabled: off }), homeNote(t('set.ticktick_note'))));
}

// ---------- 🛠 Geavanceerd ----------

function advancedBlock() {
  const keys = el('div', { class: 'set-keys' });
  const webhook = el('div', {});
  const body = el('div', { class: 'set-body' });
  S.parts.advanced = body;
  S.parts.keys = keys;
  S.parts.webhook = webhook;
  return el('details', { class: 'set-block set-adv' },
    el('summary', {}, el('span', { class: 'set-icon', 'aria-hidden': 'true' }, '🛠'), t('set.advanced'), el('span', { class: 'set-sub' }, t('set.advanced_sub'))),
    body, el('h3', { class: 'set-h3' }, t('set.keys')), keys, el('h3', { class: 'set-h3' }, t('set.webhook')), webhook);
}

function paintAdvanced() {
  const s = current();
  const off = !S.online;
  const lang = select(t('set.default_lang'), [['en', t('set.lang_en')], ['nl', t('set.lang_nl')]], s.defaultLocale,
    (v) => save({ defaultLocale: v }, () => { lang.value = current().defaultLocale; }), off);
  paint('advanced', row(t('set.default_lang'), lang, homeNote(t('set.default_lang_note'))));
  paintWebhook();
  paintKeys();
}

function paintWebhook() {
  const s = S.settings ?? cachedSettings();
  const off = !S.online;
  const input = /** @type {HTMLInputElement} */ (el('input', {
    type: 'url', class: 'set-url', inputmode: 'url', autocomplete: 'off', disabled: off, 'aria-label': t('set.webhook'),
    placeholder: s.fallbackFromEnv ? t('set.webhook_from_install') : 'https://…',
  }));
  input.value = s.fallbackFromEnv ? '' : s.fallbackWebhook ?? '';
  const saveIt = async () => {
    const v = input.value.trim();
    // Leeg laten terwijl hij uit de installatie komt: niets veranderen, tenzij je hem expliciet uitzet.
    if (!v && s.fallbackFromEnv) return;
    if (await save({ fallbackWebhook: v })) paintWebhook();
  };
  const test = btn(t('set.test'), async () => {
    try {
      const r = await request('POST', '/api/settings/webhook-test', {});
      if (r.ok) toast(t('set.webhook_test_ok'), 'ok'); else toast(t('set.webhook_test_failed'));
    } catch (e) { toast(offlineText(e)); }
  }, { disabled: off || !(s.fallbackWebhook || s.fallbackFromEnv) });
  const offBtn = s.fallbackFromEnv ? btn(t('set.switch_off'), async () => { if (await save({ fallbackWebhook: '' })) paintWebhook(); }, { kind: 'danger', disabled: off }) : null;
  // Hier ingesteld (D1), ook "uit": Herstellen wist die rij, zodat het adres uit de installatie (als die er een heeft) weer geldt.
  const own = !!s.fallbackOverride;
  const resetBtn = own ? btn(t('set.webhook_reset'), async () => { if (await save({ fallbackWebhook: null })) paintWebhook(); }, { disabled: off }) : null;
  paint('webhook',
    note(homeNote(s.fallbackFromEnv ? t('set.webhook_from_install_note') : t('set.webhook_note'))),
    el('div', { class: 'set-inline' }, input, btn(t('set.save'), saveIt, { kind: '', disabled: off }), test, offBtn, resetBtn),
    own && S.online ? note(t('set.webhook_reset_note')) : null);
}

const kindLabel = (kind) => (kind === 'inbox' ? t('set.kind_inbox') : t('set.kind_full'));
const lastUsed = (iso) => (iso ? t('set.last_used', { when: ago(iso) }) : t('set.never_used'));

async function revokeKey(k) {
  const text = recent(k.last_used_at) ? `${t('set.revoke_text')} ${t('set.recent_warning')}` : t('set.revoke_text');
  const yes = await ask({ title: t('set.revoke_title', { name: k.name }), text, buttons: [
    { label: t('set.revoke'), value: 'yes', kind: 'danger' }, { label: t('set.cancel'), value: null, kind: 'ghost' }] });
  if (!yes) return;
  try {
    await request('DELETE', `/api/keys/${encodeURIComponent(k.id)}`);
    paintKeys();
    paintDevices();
  } catch (e) { toast(offlineText(e)); }
}

async function toggleEnv(k) {
  const off = !k.off;
  if (off && recent(k.last_used_at)) {
    const yes = await ask({ title: t('set.env_off_title'), text: t('set.recent_warning'), buttons: [
      { label: t('set.switch_off'), value: 'yes', kind: 'danger' }, { label: t('set.cancel'), value: null, kind: 'ghost' }] });
    if (!yes) return;
  }
  try {
    await request('PATCH', `/api/keys/${k.id}`, { off });
    paintKeys();
    paintDevices();
  } catch (e) { toast(offlineText(e)); }
}

async function newKey() {
  const answer = await askKey({ title: t('set.new_key'), text: t('set.new_key_text'), withKind: true });
  if (!answer) return;
  const key = await createKey(answer.name, answer.kind);
  if (!key) return;
  await modal({
    title: t('set.new_key'),
    body: [el('p', {}, t('set.key_once', { name: key.name })), secret(t('set.key'), key.key)],
    buttons: [{ label: t('set.done'), value: 'ok' }],
  });
  paintKeys();
  paintDevices();
}

async function paintKeys() {
  const add = btn(t('set.new_key_button'), newKey, { disabled: !S.online });
  let rows;
  try {
    if (!S.loaded) return; // de instellingen tekenen dit opnieuw zodra ze er zijn
    if (!S.online) throw new Offline(t('set.online_only'));
    const r = await request('GET', '/api/keys');
    rows = [
      ...r.keys.map((k) => row(`${k.name}`, btn(t('set.revoke'), () => revokeKey(k), { kind: 'danger' }),
        [kindLabel(k.kind), `…${k.hint}`, t('set.created', { date: fmtDate(k.created_at) }), lastUsed(k.last_used_at)].join(' · '))),
      ...r.env.map((k) => el('div', {},
        row(t('set.env_key', { kind: kindLabel(k.kind) }), btn(k.off ? t('set.switch_on') : t('set.switch_off'), () => toggleEnv(k), { kind: k.off ? '' : 'danger' }),
          [k.off ? t('set.env_is_off') : lastUsed(k.last_used_at), t('set.env_remove')].join(' · ')),
        el('p', { class: 'set-note' }, el('code', {}, `npx wrangler secret delete ${ENV_SECRET[k.id] ?? ''}`)))),
    ];
    if (!rows.length) rows = [note(t('set.no_keys'))];
  } catch (e) {
    rows = [note(offlineText(e))];
  }
  if (!S.open) return;
  paint('keys', ...rows, row('', add));
}

// ---------- openen en sluiten ----------

function build() {
  S.parts = {};
  const root = el('div', { id: 'settings', class: 'settings' },
    el('button', { type: 'button', class: 'set-back', onclick: () => closeSettings() }, t('set.back')),
    displayBlock(),
    block('🌍', t('set.langtime'), 'langtime'),
    block('🔔', t('set.notifications'), 'push'),
    block('📱', t('set.devices'), 'devices'),
    block('👤', t('set.account'), 'account'),
    block('💾', t('set.data'), 'data'),
    advancedBlock());
  return root;
}

export const isSettingsOpen = () => S.open;

/**
 * Opent de instellingen in de middenkolom.
 * @param {{ push?: boolean }} [opts] push: een eigen stap in de geschiedenis (niet bij terug/vooruit)
 */
export function openSettings({ push = true } = {}) {
  closeDrawer();
  if (S.open) return;
  S.open = true;
  if (push) history.pushState({ settings: true }, '');
  S.settings = cachedSettings();
  S.online = false;
  S.loaded = false;
  S.root = build();
  $('#main').append(S.root);
  document.body.classList.add('settings-open');
  render(); // de zijbalk zet de titel op Instellingen en markeert geen lijst meer (zie updateHeader)
  $('#main').scrollTop = 0;
  window.scrollTo(0, 0);
  paintHome(); // eerst met de laatst bekende waarden, uitgeschakeld
  paint('devices', note(t('set.loading')));
  const reg = getReg().then((r) => { S.reg = r; if (S.open) paintPush(); });
  Promise.all([reg, fetchSettings()]).then(() => { if (S.open) { paintHome(); paintDevices(); } });
}

/** Verbergt de pagina zonder de geschiedenis te raken (voor popstate). */
export function hideSettings() {
  if (!S.open) return;
  S.open = false;
  S.root?.remove();
  S.root = null;
  document.body.classList.remove('settings-open');
  render(); // titel en lijst weer zoals daarvoor
}

/** Sluit de pagina; met een eigen stap in de geschiedenis via terug, zodat die stap niet blijft hangen. */
export function closeSettings() {
  if (!S.open) return;
  if (history.state?.settings) history.back(); // popstate verbergt de pagina
  else hideSettings();
}


// Esc buiten een veld sluit de pagina (niet als er een dialoog of het uitschuifmenu open is).
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape' || !S.open) return;
  if (document.querySelector('dialog[open]') || document.body.classList.contains('drawer-open')) return;
  if (e.target instanceof Element && e.target.closest('input, textarea, select, [contenteditable]')) return;
  e.stopPropagation();
  closeSettings();
}, true);
