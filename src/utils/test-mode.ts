import { getSetting, setSetting } from '../db/settings.js';
import { logger } from './logger.js';

export function isTestMode(): boolean {
  return getSetting('test_mode') === 'true';
}

export function getTestEmail(): string {
  return getSetting('test_mode_email');
}

export function testTag(): string {
  return isTestMode() ? '🧪 ' : '';
}

export function toggleTestMode(): boolean {
  const current = isTestMode();
  setSetting('test_mode', current ? 'false' : 'true');
  const newState = !current;
  logger.info(`Test mode ${newState ? 'ENABLED' : 'DISABLED'}`);
  return newState;
}

export function testSentVia(via: string): string {
  return isTestMode() ? `${via}_test` : via;
}
