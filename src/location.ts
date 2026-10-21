import { HttpError } from './errors';

export type Loc = { name: string; lat: number; lng: number; radius: number; trigger: 'enter' | 'exit' };

// Onder 200 m geeft de onnauwkeurigheid van de locatie binnenshuis valse meldingen bij vertrek.
export const RADIUS_MIN = 200;
export const RADIUS_MAX = 2000;
// Vertrek: klein, dan meldt Android het eerder. Aankomst: groter, zodat je er met de auto niet doorheen rijdt.
export const RADIUS_DEFAULT = { enter: 500, exit: 200 } as const;
/** Straal voor een favoriet zonder straal; een favoriet heeft geen trigger. */
export const PLACE_RADIUS_DEFAULT = RADIUS_DEFAULT.enter;
export const MAX_LOC_NAME = 100;

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
  return { name, lat, lng, radius, trigger };
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

/** De vijf loc_*-kolommen voor een INSERT of UPDATE; null wist ze. */
export function locColumns(loc: Loc | null): Record<string, unknown> {
  return {
    loc_name: loc?.name ?? null,
    loc_lat: loc?.lat ?? null,
    loc_lng: loc?.lng ?? null,
    loc_radius: loc?.radius ?? null,
    loc_trigger: loc?.trigger ?? null,
  };
}

/** Bouwt de locatie uit een taakrij; null als er geen is ingesteld. */
export function locFromRow(row: {
  loc_name: string | null; loc_lat: number | null; loc_lng: number | null; loc_radius: number | null; loc_trigger: string | null;
}): Loc | null {
  if (row.loc_name === null || row.loc_lat === null || row.loc_lng === null || row.loc_radius === null || row.loc_trigger === null) return null;
  return { name: row.loc_name, lat: row.loc_lat, lng: row.loc_lng, radius: row.loc_radius, trigger: row.loc_trigger as Loc['trigger'] };
}
