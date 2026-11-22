// Een zip-bestand uitpakken in de browser, zonder bibliotheek: alleen wat de Todoist-back-up nodig heeft (bestanden
// "opgeslagen" of met deflate, geen versleuteling, geen zip64). DecompressionStream doet het eigenlijke uitpakken.

/** Grootste totale uitgepakte grootte die we accepteren (een zip-bom houdt hier op). */
const MAX_TOTAL = 20 * 1024 * 1024;

/**
 * De tekstbestanden in een zip waarvan de naam bij `want` past, als { name, text }. Gooit bij een kapotte of te grote zip.
 * @param {ArrayBuffer} buf
 * @param {(name: string) => boolean} want
 * @returns {Promise<{ name: string, text: string }[]>}
 */
export async function unzipText(buf, want) {
  const v = new DataView(buf);
  // Het einde van de centrale map: handtekening 0x06054b50, ergens in de laatste 64 kB (er kan een opmerking achter staan).
  let eocd = -1;
  for (let i = buf.byteLength - 22; i >= Math.max(0, buf.byteLength - 22 - 65535); i--) {
    if (v.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('zip');
  const count = v.getUint16(eocd + 10, true);
  let p = v.getUint32(eocd + 16, true);
  const dec = new TextDecoder();
  /** @type {{ name: string, text: string }[]} */
  const out = [];
  let total = 0;
  for (let n = 0; n < count; n++) {
    if (p + 46 > buf.byteLength || v.getUint32(p, true) !== 0x02014b50) throw new Error('zip');
    const flags = v.getUint16(p + 8, true);
    const method = v.getUint16(p + 10, true);
    const size = v.getUint32(p + 20, true);
    const usize = v.getUint32(p + 24, true);
    const nameLen = v.getUint16(p + 28, true);
    const extraLen = v.getUint16(p + 30, true);
    const commentLen = v.getUint16(p + 32, true);
    const local = v.getUint32(p + 42, true);
    const name = dec.decode(new Uint8Array(buf, p + 46, nameLen));
    p += 46 + nameLen + extraLen + commentLen;
    if (name.endsWith('/') || !want(name)) continue;
    if (flags & 1) throw new Error('zip'); // versleuteld
    total += usize;
    if (total > MAX_TOTAL) throw new Error('zip');
    if (local + 30 > buf.byteLength || v.getUint32(local, true) !== 0x04034b50) throw new Error('zip');
    const start = local + 30 + v.getUint16(local + 26, true) + v.getUint16(local + 28, true);
    if (start + size > buf.byteLength) throw new Error('zip');
    const data = new Uint8Array(buf, start, size);
    let bytes;
    if (method === 0) bytes = data;
    else if (method === 8) {
      const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
      bytes = new Uint8Array(await new Response(stream).arrayBuffer());
    } else throw new Error('zip');
    out.push({ name, text: dec.decode(bytes) });
  }
  return out;
}
