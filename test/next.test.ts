import { describe, expect, it } from 'vitest';
import { safeNext } from '../public/next.js';

describe('safeNext', () => {
  it.each([null, '', 'https://evil.example', '//evil.example', '/\\evil.example', 'javascript:alert(1)', 'evil', '/\t/evil.example', '/\n/evil.example', '/\r/evil.example', '/ok\\x'])('%s wordt /', (v) =>
    expect(safeNext(v)).toBe('/'));
  it('een eigen pad met query blijft', () => expect(safeNext('/?app=android&pair=1')).toBe('/?app=android&pair=1'));
});
