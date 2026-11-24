import { describe, expect, it } from 'vitest';

// Regressie: de Home Assistant-trigger stond alleen in het taakpaneel, niet in de invoerkaart (2026-11-24). Beide moeten
// hem tonen; de kaart slaat de keuze op zodra de nieuwe taak op de server staat, net als delen.
const src = import.meta.glob<string>('../public/{composer,detail,hatrigger}.js', { query: '?raw', import: 'default', eager: true });
const composer = src['../public/composer.js'];
const detail = src['../public/detail.js'];
const ha = src['../public/hatrigger.js'];

describe('Home Assistant-trigger in de invoerkaart', () => {
  it('de kaart toont de stap als er triggers zijn en haalt ze op bij focus', () => {
    expect(composer).toMatch(/from '\.\/hatrigger\.js'/);
    expect(composer).toMatch(/haChoices\(\)\.length \? step\('hatrigger'/);
    expect(composer).toMatch(/focusin[^\n]*refreshHa\(draw\)/);
  });

  it('de keuze gaat na het aanmaken naar de server, en telt als "kaart ingevuld"', () => {
    expect(composer).toMatch(/card\.ha\.length\) await linkTriggers\(id, card\.ha\)/);
    expect(composer).toMatch(/card\.share \|\| card\.ha\.length \|\| card\.files\.length\) afterCreate/);
    expect(composer).toMatch(/v\.ha\.length/);
  });

  it('kaart en paneel gebruiken hetzelfde trigger-menu', () => {
    expect(ha).toMatch(/export function pickTriggers/);
    expect(ha).toMatch(/const pick = \(anchor\) => pickTriggers\(/);
    expect(composer).toMatch(/pickTriggers\(anchor, v\.ha/);
    expect(detail).toMatch(/haStep\(t, /);
  });

  it('refreshHa laat elke wachtende aanroeper weten dat er iets nieuws is', () => {
    expect(ha).toMatch(/waiting\.add\(done\)/);
    expect(ha).toMatch(/for \(const fn of waiting\) fn\(\)/);
  });
});
