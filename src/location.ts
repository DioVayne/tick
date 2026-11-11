import { HttpError } from './errors';

/** Eén plek van een taak: naam, middelpunt en straal. */
export type Spot = { name: string; lat: number; lng: number; radius: number };
/**
 * De plek(ken) van een taak. De eerste staat in de velden zelf, de andere (`more`, alleen als die er zijn) delen de
 * trigger: de melding komt bij de eerste plek waar je aankomt (of die je verlaat), één keer voor de hele taak.
 */
export type Loc = Spot & { trigger: 'enter' | 'exit'; more?: Spot[] };

// Onder 200 m geeft de onnauwkeurigheid van de locatie binnenshuis valse meldingen bij vertrek.
export const RADIUS_MIN = 200;
export const RADIUS_MAX = 2000;
// Vertrek: klein, dan meldt Android het eerder. Aankomst: groter, zodat je er met de auto niet doorheen rijdt.
export const RADIUS_DEFAULT = { enter: 500, exit: 200 } as const;
/** Straal voor een favoriet zonder straal; een favoriet heeft geen trigger. */
export const PLACE_RADIUS_DEFAULT = RADIUS_DEFAULT.enter;
export const MAX_LOC_NAME = 100;
/**
 * Zoveel plekken heeft een taak hooguit (de eerste plus `more`). Android bewaakt per app ongeveer 100 plekken; met 10
 * per taak passen er altijd minstens 10 taken in, en meer plekken voor één taak is geen "kies je eigen winkels" meer.
 */
export const MAX_PLACES = 10;

export type Place = { id: string; name: string; lat: number; lng: number; radius: number };

// Gedeelde veldcontroles; `p` is het voorvoegsel in de foutmelding ("location." of leeg).
function cleanName(v: unknown, p: string): string {
  const name = typeof v === 'string' ? v.trim() : '';
  if (!name) throw new HttpError(400, 'err.required', { field: `${p}name` });
  if (name.length > MAX_LOC_NAME) throw new HttpError(400, 'err.too_long', { field: `${p}name`, max: MAX_LOC_NAME });
  return name;
}

function cleanLat(v: unknown, p: string): number {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < -90 || v > 90) throw new HttpError(400, 'err.range', { field: `${p}lat`, min: -90, max: 90 });
  return v;
}

function cleanLng(v: unknown, p: string): number {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < -180 || v > 180) throw new HttpError(400, 'err.range', { field: `${p}lng`, min: -180, max: 180 });
  return v;
}

function cleanRadius(v: unknown, p: string): number {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < RADIUS_MIN || v > RADIUS_MAX) {
    throw new HttpError(400, 'err.int_range', { field: `${p}radius`, min: RADIUS_MIN, max: RADIUS_MAX });
  }
  return v;
}

/** Controleert een locatie uit de invoer; null of weglaten betekent "geen locatie". */
export function cleanLocation(v: unknown): Loc | null {
  if (v === null || v === undefined) return null;
  if (typeof v !== 'object' || Array.isArray(v)) throw new HttpError(400, 'err.location_type');
  const o = v as Record<string, unknown>;
  const p = 'location.';
  const name = cleanName(o.name, p);
  const lat = cleanLat(o.lat, p);
  const lng = cleanLng(o.lng, p);
  const trigger = o.trigger ?? 'enter';
  if (trigger !== 'enter' && trigger !== 'exit') throw new HttpError(400, 'err.trigger');
  const radius = cleanRadius(o.radius ?? RADIUS_DEFAULT[trigger], p);
  const more = cleanMore(o.more, trigger);
  return more.length ? { name, lat, lng, radius, trigger, more } : { name, lat, lng, radius, trigger };
}

/** De extra plekken van een taak (`location.more`): een lijst van hooguit MAX_PLACES - 1, elk met naam, lat, lng en straal. */
function cleanMore(v: unknown, trigger: Loc['trigger']): Spot[] {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v)) throw new HttpError(400, 'err.location_type');
  if (v.length > MAX_PLACES - 1) throw new HttpError(400, 'err.too_many_places', { max: MAX_PLACES });
  return v.map((s, i) => {
    if (typeof s !== 'object' || s === null || Array.isArray(s)) throw new HttpError(400, 'err.location_type');
    const o = s as Record<string, unknown>;
    const p = `location.more.${i}.`;
    return { name: cleanName(o.name, p), lat: cleanLat(o.lat, p), lng: cleanLng(o.lng, p), radius: cleanRadius(o.radius ?? RADIUS_DEFAULT[trigger], p) };
  });
}

/**
 * `loc_more` uit de database of een back-up als nette JSON-tekst, of null als er niets (bruikbaars) in staat. Een
 * kapotte waarde maakt de taak niet onbruikbaar: dan alleen de eerste plek.
 */
export function cleanMoreJson(v: unknown, trigger: unknown): string | null {
  if (typeof v !== 'string' || !v) return null;
  try {
    const more = cleanMore(JSON.parse(v), trigger === 'exit' ? 'exit' : 'enter');
    return more.length ? JSON.stringify(more) : null;
  } catch {
    return null;
  }
}

/** Controleert een favoriete plek; bij `partial` (PATCH) hoeven alleen de meegegeven velden te kloppen. Een trigger wordt genegeerd. */
export function cleanPlace(v: unknown, partial: boolean): Partial<Omit<Place, 'id'>> {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new HttpError(400, 'err.expected_object');
  const o = v as Record<string, unknown>;
  const out: Partial<Omit<Place, 'id'>> = {};
  if (!partial || 'name' in o) out.name = cleanName(o.name, '');
  if (!partial || 'lat' in o) out.lat = cleanLat(o.lat, '');
  if (!partial || 'lng' in o) out.lng = cleanLng(o.lng, '');
  if (!partial || 'radius' in o) out.radius = cleanRadius(partial ? o.radius : o.radius ?? PLACE_RADIUS_DEFAULT, '');
  return out;
}

/** Alleen de ligging van de extra plekken (zonder namen), om een echt andere plek te herkennen. */
export function moreSpots(json: unknown, trigger: unknown): string {
  const more = cleanMoreJson(json, trigger);
  return more ? JSON.stringify((JSON.parse(more) as Spot[]).map((s) => [s.lat, s.lng, s.radius])) : '';
}

/** De zes loc_*-kolommen voor een INSERT of UPDATE; null wist ze. `loc_more` is JSON, of null bij één plek. */
export function locColumns(loc: Loc | null): Record<string, unknown> {
  return {
    loc_name: loc?.name ?? null,
    loc_lat: loc?.lat ?? null,
    loc_lng: loc?.lng ?? null,
    loc_radius: loc?.radius ?? null,
    loc_trigger: loc?.trigger ?? null,
    loc_more: loc?.more?.length ? JSON.stringify(loc.more) : null,
  };
}

/** Bouwt de locatie uit een taakrij; null als er geen is ingesteld. `more` staat er alleen in als er extra plekken zijn. */
export function locFromRow(row: {
  loc_name: string | null; loc_lat: number | null; loc_lng: number | null; loc_radius: number | null; loc_trigger: string | null;
  loc_more?: string | null;
}): Loc | null {
  if (row.loc_name === null || row.loc_lat === null || row.loc_lng === null || row.loc_radius === null || row.loc_trigger === null) return null;
  const loc: Loc = { name: row.loc_name, lat: row.loc_lat, lng: row.loc_lng, radius: row.loc_radius, trigger: row.loc_trigger as Loc['trigger'] };
  const more = cleanMoreJson(row.loc_more, row.loc_trigger);
  if (more) loc.more = JSON.parse(more) as Spot[];
  return loc;
}
