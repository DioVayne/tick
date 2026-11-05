import type { Env } from './index';

/**
 * Een openbare Tick (`OPEN_SIGNUP` = "true"): iedereen kan zelf een account maken, accounts zien elkaar niet, en delen
 * gaat via e-mailadres. Uit (standaard) werkt alles zoals op een Tick voor een huishouden of klein team.
 */
export function openSignup(env: Env): boolean {
  return env.OPEN_SIGNUP?.trim() === 'true';
}

export const DEFAULT_SIGNUP_LIMIT = 100;

/** `SIGNUP_DAILY_LIMIT` als geheel getal vanaf 1, anders 100. */
export function signupDailyLimit(env: Env): number {
  const n = Number(env.SIGNUP_DAILY_LIMIT);
  return Number.isInteger(n) && n >= 1 ? n : DEFAULT_SIGNUP_LIMIT;
}
