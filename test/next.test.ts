import { describe, expect, it } from 'vitest';
import { afterLogin, safeNext } from '../public/next.js';

describe('safeNext', () => {
  it.each([null, '', 'https://evil.example', '//evil.example', '/\\evil.example', 'javascript:alert(1)', 'evil', '/\t/evil.example', '/\n/evil.example', '/\r/evil.example', '/ok\\x'])('%s wordt /', (v) =>
    expect(safeNext(v)).toBe('/'));
  it('een eigen pad met query blijft', () => expect(safeNext('/?app=android&pair=1')).toBe('/?app=android&pair=1'));
});

describe('afterLogin', () => {
  it('na inloggen in de app altijd opnieuw koppelen', () => {
    expect(afterLogin('/?task=x', true)).toBe('/?task=x&app=android&pair=1');
    expect(afterLogin(null, true)).toBe('/?app=android&pair=1');
    expect(afterLogin('/?app=android', false)).toBe('/?app=android&pair=1');
    expect(afterLogin('//evil.example', true)).toBe('/?app=android&pair=1');
  });

  it('buiten de app verandert er niets', () => {
    expect(afterLogin('/?task=x', false)).toBe('/?task=x');
    expect(afterLogin(null, false)).toBe('/');
  });
});
