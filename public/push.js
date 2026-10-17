import { request } from './api.js';
import { getLocale, t } from './i18n.js';

const b64uToBytes = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(s.length / 4) * 4, '=')), (c) => c.charCodeAt(0));
const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent);
const supported = (reg) => !!reg && 'PushManager' in window && 'Notification' in window;

/**
 * Stand van web push in deze browser. Verwacht de registratie van de service worker (of null).
 * @param {ServiceWorkerRegistration | null} reg
 * @returns {Promise<{ supported: boolean, permission: NotificationPermission | 'unsupported', subscribed: boolean, iosNeedsHomeScreen: boolean }>}
 */
export async function pushState(reg) {
  // Op iPhone/iPad bestaat push pas als Tick vanaf het beginscherm draait.
  const iosNeedsHomeScreen = isIos() && !isStandalone();
  if (!supported(reg)) return { supported: false, permission: 'unsupported', subscribed: false, iosNeedsHomeScreen };
  const sub = await reg.pushManager.getSubscription().catch(() => null);
  return { supported: true, permission: Notification.permission, subscribed: !!sub, iosNeedsHomeScreen };
}

/** Vraagt toestemming, meldt deze browser aan bij de server (met de huidige taal). Gooit een Error met een leesbare tekst. */
export async function enablePush(reg) {
  if (!supported(reg)) throw new Error(t('push.unsupported'));
  if ((await Notification.requestPermission()) !== 'granted') throw new Error(t('push.denied'));
  const { vapidPublicKey } = await request('GET', '/api/config');
  const sub = await reg.pushManager.getSubscription()
    ?? await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64uToBytes(vapidPublicKey) });
  await request('POST', '/api/push/subscribe', { ...sub.toJSON(), locale: getLocale() });
}

/** Meldt deze browser af, bij de server en in de browser zelf. */
export async function disablePush(reg) {
  if (!supported(reg)) return;
  const sub = await reg.pushManager.getSubscription();
  if (!sub) return;
  await request('DELETE', '/api/push/subscribe', { endpoint: sub.endpoint });
  await sub.unsubscribe();
}

/** Na een taalwissel: hetzelfde abonnement opnieuw melden, zodat meldingen in de nieuwe taal komen. */
export async function resubscribeLocale(reg) {
  if (!supported(reg)) return;
  const sub = await reg.pushManager.getSubscription();
  if (sub) await request('POST', '/api/push/subscribe', { ...sub.toJSON(), locale: getLocale() });
}
