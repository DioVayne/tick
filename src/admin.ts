import { Hono, type Context } from 'hono';
import type { AppEnv, Env, TaskRow } from './index';
import { HttpError } from './errors';
import { serveAttachment } from './attachments';
import { bumpSessionVersionStmt } from './auth';
import { openSignup } from './signup';
import type { ReportRow } from './reports';
import { wipeStmts } from './trash';
import { normLocale, translate } from '../public/i18n.js';

/**
 * De beheerpagina voor meldingen (openbare Tick): een lijst, één melding met de gemelde inhoud zoals hij nu is, de
 * bestanden daarvan (alleen die), en de acties niets aan de hand, inhoud verwijderen, schorsen en opheffen. Alleen
 * voor de beheerder met een sessie; acties alleen vanaf Tick zelf (Origin). Pagina's door de server, zonder inline
 * code (CSP): stijl in public/admin.css, de bevestiging in public/admin.js.
 */
export const adminPages = new Hono<AppEnv>();

const esc = (v: string) => v.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);

adminPages.use('*', async (c, next) => {
  if (!openSignup(c.env)) throw new HttpError(404, 'err.not_found');
  const kind = c.get('auth')?.kind;
  if ((kind !== 'session' && kind !== 'dev') || c.get('user')?.role !== 'admin') throw new HttpError(403, 'err.forbidden');
  await next();
});

type Person = { id: string; name: string; email: string | null; created_at: string; suspended_at: string | null; role: string };

async function reportOf(db: D1Database, id: string): Promise<ReportRow> {
  const r = await db.prepare('SELECT * FROM reports WHERE id = ?').bind(id).first<ReportRow>();
  if (!r) throw new HttpError(404, 'err.not_found');
  return r;
}

/** De taak-ids waar de gemelde inhoud in zit: de taak met subtaken, of de taken (en subtaken) van de gemelde lijst. */
async function contentTaskIds(db: D1Database, r: ReportRow): Promise<string[]> {
  const { results } = r.list_id
    ? await db.prepare('SELECT id FROM tasks WHERE shared_list = ?1 OR parent_id IN (SELECT id FROM tasks WHERE shared_list = ?1)').bind(r.list_id).all<{ id: string }>()
    : r.task_id
      ? await db.prepare('SELECT id FROM tasks WHERE id = ?1 OR parent_id = ?1').bind(r.task_id).all<{ id: string }>()
      : { results: [] };
  return results.map((x) => x.id);
}

function page(lang: 'en' | 'nl', title: string, body: string): string {
  return `<!doctype html>
<html lang="${lang}"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${esc(title)}</title><meta name="theme-color" content="#ffffff">
<script src="/theme.js"></script><link rel="stylesheet" href="/login.css"><link rel="stylesheet" href="/admin.css">
</head><body><main class="page admin">
${body}
</main><script type="module" src="/admin.js"></script></body></html>`;
}

const when = (iso: string | null, lang: string) => (iso ? new Date(iso).toLocaleString(lang === 'nl' ? 'nl-NL' : 'en-GB', { timeZone: 'UTC' }) + ' UTC' : '');

adminPages.get('/reports', async (c) => {
  const lang = normLocale(c.get('lang'));
  const t = (k: string, v?: Record<string, string>) => translate(lang, k, v);
  const { results } = await c.env.DB.prepare('SELECT r.*, a.name AS reporter_name, b.name AS reported_name FROM reports r ' +
    'LEFT JOIN users a ON a.id = r.reporter_id LEFT JOIN users b ON b.id = r.reported_id ' +
    "ORDER BY CASE WHEN r.status = 'open' THEN 0 ELSE 1 END, r.created_at DESC LIMIT 200")
    .all<ReportRow & { reporter_name: string | null; reported_name: string | null }>();
  // Een verwijderd account (id NULL, of een id zonder account) heet "verwijderd account"; een gewiste titel krijgt een vaste tekst.
  const name = (n: string | null) => (n === null ? `<em>${t('admin.account_deleted')}</em>` : esc(n));
  const rows = results.map((r) => `<tr><td>${esc(when(r.created_at, lang))}</td><td><a href="/admin/reports/${r.id}">${r.title ? esc(r.title) : `<em>${t('admin.title_removed')}</em>`}</a></td>` +
    `<td>${esc(t(`report.reason_${r.reason}`))}</td><td>${name(r.reporter_name)}</td><td>${name(r.reported_name)}</td><td>${esc(t(`admin.status_${r.status}`))}</td></tr>`).join('\n');
  return c.html(page(lang, t('admin.reports_title'), `<h1>${t('admin.reports_title')}</h1>
${results.length ? `<div class="scroll"><table><thead><tr><th>${t('admin.col_when')}</th><th>${t('admin.col_what')}</th><th>${t('admin.col_reason')}</th>` +
    `<th>${t('admin.col_reporter')}</th><th>${t('admin.col_reported')}</th><th>${t('admin.col_status')}</th></tr></thead><tbody>
${rows}
</tbody></table></div>` : `<p>${t('admin.none')}</p>`}
<p><a href="/">${t('admin.to_app')}</a></p>`));
});

adminPages.get('/reports/:id', async (c) => {
  const db = c.env.DB;
  const lang = normLocale(c.get('lang'));
  const t = (k: string, v?: Record<string, string>) => translate(lang, k, v);
  const r = await reportOf(db, c.req.param('id'));
  const who = async (id: string | null) => (id ? db.prepare('SELECT id, name, email, created_at, suspended_at, role FROM users WHERE id = ?').bind(id).first<Person>() : null);
  const [reporter, reported] = await Promise.all([who(r.reporter_id), who(r.reported_id)]);
  const person = (p: Person | null) => (p
    ? `${esc(p.name)} &lt;${esc(p.email ?? '')}&gt; · ${t('admin.since', { date: esc(when(p.created_at, lang)) })}${p.suspended_at ? ` · <strong>${t('admin.suspended')}</strong>` : ''}`
    : `<em>${t('admin.account_gone')}</em>`);
  const title = r.title || t('admin.title_removed');
  // Losgekoppeld bij het verwijderen van een account: uitleggen wat er weg is.
  const anonymised = r.reporter_id === null || r.reported_id === null;

  // De inhoud zoals hij nu is.
  const ids = await contentTaskIds(db, r);
  let content: string;
  if (!ids.length) content = `<p class="gone">${t('admin.gone')}</p>`;
  else {
    const { results: tasks } = await db.prepare('SELECT id, title, description, parent_id, deleted_at FROM tasks WHERE id IN (SELECT value FROM json_each(?)) ORDER BY parent_id IS NOT NULL, position')
      .bind(JSON.stringify(ids)).all<Pick<TaskRow, 'id' | 'title' | 'description' | 'parent_id' | 'deleted_at'>>();
    const { results: files } = await db.prepare("SELECT id, task_id, name, mime, size FROM attachments WHERE status = 'ready' AND task_id IN (SELECT value FROM json_each(?)) ORDER BY created_at")
      .bind(JSON.stringify(ids)).all<{ id: string; task_id: string; name: string; mime: string; size: number }>();
    const shown = r.attachment_id ? files.filter((f) => f.id === r.attachment_id) : files;
    const fileHtml = (f: typeof files[number]) => {
      const url = `/admin/reports/${r.id}/files/${f.id}`;
      return `<li>${f.mime.startsWith('image/') ? `<a href="${url}"><img src="${url}" alt="${esc(f.name)}" loading="lazy"></a><br>` : ''}<a href="${url}">${esc(f.name)}</a> (${Math.ceil(f.size / 1024)} kB)</li>`;
    };
    content = `<ul class="tasks">${tasks.map((x) => `<li${x.parent_id ? ' class="sub"' : ''}><strong>${esc(x.title)}</strong>${x.deleted_at ? ` <em>(${t('admin.in_trash')})</em>` : ''}` +
      `${x.description ? `<p class="desc">${esc(x.description)}</p>` : ''}</li>`).join('')}</ul>` +
      (r.attachment_id && !shown.length ? `<p class="gone">${t('admin.file_gone', { name: esc(r.attachment_name ?? '') })}</p>` : '') +
      (shown.length ? `<h2>${t('admin.files')}</h2><ul class="files">${shown.map(fileHtml).join('')}</ul>` : '');
  }

  // label en confirm zijn al veilige HTML: namen gaan ge-escaped in t(...); confirm is tekst in een attribuut.
  const button = (action: string, label: string, kind = '', confirm?: string) =>
    `<form method="post" action="/admin/reports/${r.id}/${action}"${confirm ? ` data-confirm="${esc(confirm)}"` : ''}><button class="${kind}">${label}</button></form>`;
  const canSuspend = reported && reported.role !== 'admin';
  const actions = [
    r.status === 'open' ? button('dismiss', t('admin.dismiss'), 'ghost') : '',
    r.status !== 'removed' && !r.list_id && ids.length ? button('remove', t('admin.remove'), 'danger', t('admin.remove_confirm')) : '',
    canSuspend && !reported.suspended_at ? button('suspend', t('admin.suspend', { name: esc(reported.name) }), 'danger', t('admin.suspend_confirm', { name: reported.name })) : '',
    canSuspend && reported.suspended_at ? button('unsuspend', t('admin.unsuspend', { name: esc(reported.name) })) : '',
  ].join('');

  return c.html(page(lang, title, `<p><a href="/admin/reports">← ${t('admin.reports_title')}</a></p>
<h1>${esc(title)}${r.attachment_name ? ` — ${esc(r.attachment_name)}` : ''}</h1>
${anonymised ? `<p class="gone">${t('admin.anonymised')}</p>` : ''}
<dl>
<dt>${t('admin.col_reason')}</dt><dd>${esc(t(`report.reason_${r.reason}`))}</dd>
${r.note ? `<dt>${t('admin.note')}</dt><dd>${esc(r.note)}</dd>` : ''}
<dt>${t('admin.col_when')}</dt><dd>${esc(when(r.created_at, lang))}</dd>
<dt>${t('admin.col_reporter')}</dt><dd>${person(reporter)}</dd>
<dt>${t('admin.col_reported')}</dt><dd>${person(reported)}</dd>
<dt>${t('admin.col_status')}</dt><dd>${esc(t(`admin.status_${r.status}`))}${r.handled_at ? ` · ${esc(when(r.handled_at, lang))}` : ''}</dd>
</dl>
<h2>${t('admin.content')}</h2>
${content}
<div class="actions">${actions}</div>`));
});

adminPages.get('/reports/:id/files/:attachmentId', async (c) => {
  const db = c.env.DB;
  if (!c.env.FILES) throw new HttpError(404, 'err.not_found');
  const r = await reportOf(db, c.req.param('id'));
  const ids = await contentTaskIds(db, r);
  const row = await db.prepare("SELECT r2_key, size, mime, name, task_id FROM attachments WHERE id = ? AND status = 'ready'").bind(c.req.param('attachmentId'))
    .first<{ r2_key: string; size: number; mime: string; name: string; task_id: string }>();
  if (!row || !ids.includes(row.task_id)) throw new HttpError(404, 'err.not_found');
  return serveAttachment(c, row);
});

/** Een actie mag alleen vanaf Tick zelf komen: een formulier van een andere site (of zonder Origin) → 403. */
function sameOrigin(c: Context<AppEnv>): void {
  if (c.req.header('origin') !== new URL(c.req.url).origin) throw new HttpError(403, 'err.forbidden');
}

/**
 * Schorsen: uitgelogd (sessieversie), en al het delen met anderen stopt: zijn deelrijen in beide richtingen, zijn
 * lidmaatschap van lijsten van anderen, zijn eigen gedeelde lijsten (weer gewoon zijn eigen lijsten, zoals
 * `dissolveStmts`), en zijn uitnodigingen aan adressen. Zijn eigen taken blijven bewaard. Een vast aantal statements,
 * hoeveel lijsten het ook zijn, want D1 telt elk statement van een batch als query.
 */
export function suspendStmts(db: D1Database, userId: string): D1PreparedStatement[] {
  const owned = 'SELECT id FROM tasks WHERE user_id = ?1 OR parent_id IN (SELECT id FROM tasks WHERE user_id = ?1)';
  const ts = new Date().toISOString();
  return [
    db.prepare('UPDATE users SET suspended_at = ?2 WHERE id = ?1').bind(userId, ts),
    bumpSessionVersionStmt(db, userId),
    // Meldrijen, bezorgrijen en claims tussen hem en anderen, in beide richtingen.
    db.prepare(`DELETE FROM task_watch WHERE (user_id = ?1 AND task_id NOT IN (${owned})) OR (user_id != ?1 AND task_id IN (${owned}))`).bind(userId),
    db.prepare(`DELETE FROM reminder_sent WHERE (user_id = ?1 AND task_id NOT IN (${owned})) OR (user_id != ?1 AND task_id IN (${owned}))`).bind(userId),
    db.prepare('UPDATE tasks SET claimed_by = NULL WHERE (claimed_by = ?1 AND user_id != ?1) OR (user_id = ?1 AND claimed_by IS NOT NULL AND claimed_by != ?1)').bind(userId),
    db.prepare('DELETE FROM task_shares WHERE to_user = ?1 OR from_user = ?1 OR task_id IN (SELECT id FROM tasks WHERE user_id = ?1)').bind(userId),
    // Lijsten van anderen: hij vertrekt. Zijn eigen gedeelde lijsten: opgeheven (leden en uitnodigingen via de cascade).
    db.prepare('DELETE FROM list_members WHERE user_id = ?1 AND list_id IN (SELECT id FROM shared_lists WHERE owner_id != ?1)').bind(userId),
    db.prepare('UPDATE tasks SET shared_list = NULL, claimed_by = NULL, updated_at = ?2 WHERE shared_list IN (SELECT id FROM shared_lists WHERE owner_id = ?1)').bind(userId, ts),
    db.prepare('DELETE FROM shared_lists WHERE owner_id = ?1').bind(userId),
    db.prepare('DELETE FROM email_invites WHERE from_user = ?1').bind(userId),
  ];
}

/**
 * Inhoud verwijderen: de gemelde bijlage, of de gemelde taak met subtaken (definitief, niet naar de prullenbak). De
 * bestanden gaan overal weg, ook uit geaccepteerde kopieën (zelfde R2-object); de tekst van die kopieën blijft.
 */
async function removeContent(env: Env, r: ReportRow): Promise<void> {
  const db = env.DB;
  const { results } = r.attachment_id
    ? await db.prepare('SELECT DISTINCT r2_key FROM attachments WHERE id = ?').bind(r.attachment_id).all<{ r2_key: string }>()
    : await db.prepare('SELECT DISTINCT r2_key FROM attachments WHERE task_id IN (SELECT id FROM tasks WHERE id = ?1 OR parent_id = ?1)').bind(r.task_id).all<{ r2_key: string }>();
  const keys = results.map((x) => x.r2_key);
  await db.batch([
    db.prepare('DELETE FROM attachments WHERE r2_key IN (SELECT value FROM json_each(?))').bind(JSON.stringify(keys)),
    ...(r.attachment_id || !r.task_id ? [] : wipeStmts(db, 'id = ?', [r.task_id])),
  ]);
  if (keys.length && env.FILES) await env.FILES.delete(keys);
}

adminPages.post('/reports/:id/:action', async (c) => {
  sameOrigin(c);
  const db = c.env.DB;
  const r = await reportOf(db, c.req.param('id'));
  const action = c.req.param('action');
  const ts = new Date().toISOString();
  const mark = (status: ReportRow['status']) => db.prepare('UPDATE reports SET status = ?, handled_at = ? WHERE id = ?').bind(status, ts, r.id);
  if (action === 'dismiss') await mark('dismissed').run();
  else if (action === 'remove') {
    if (r.list_id) throw new HttpError(400, 'err.not_found');
    await removeContent(c.env, r);
    await mark('removed').run();
  } else if (action === 'suspend' || action === 'unsuspend') {
    // Het gemelde account is verwijderd: er is niemand meer om te schorsen.
    if (!r.reported_id) throw new HttpError(410, 'err.account_deleted');
    const target = await db.prepare('SELECT role FROM users WHERE id = ?').bind(r.reported_id).first<{ role: string }>();
    if (!target) throw new HttpError(410, 'err.account_deleted');
    if (target.role === 'admin') throw new HttpError(400, 'err.suspend_admin');
    if (action === 'suspend') await db.batch([...suspendStmts(db, r.reported_id), mark('suspended')]);
    else await db.prepare('UPDATE users SET suspended_at = NULL WHERE id = ?').bind(r.reported_id).run();
  } else throw new HttpError(404, 'err.not_found');
  return c.redirect(`/admin/reports/${r.id}`, 303);
});
