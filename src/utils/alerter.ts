import { logger } from './logger.js';

const MAX_ALERTS_PER_HOUR = 5;
const alertHistory: number[] = [];
let suppressedCount = 0;

function isRateLimited(): boolean {
  const now = Date.now();
  const oneHourAgo = now - 60 * 60 * 1000;

  // Remove old entries
  while (alertHistory.length > 0 && alertHistory[0] < oneHourAgo) {
    alertHistory.shift();
  }

  if (alertHistory.length >= MAX_ALERTS_PER_HOUR) {
    suppressedCount++;
    return true;
  }

  alertHistory.push(now);
  return false;
}

// Lazy-loaded bot reference to avoid circular imports
let sendAlert: ((message: string) => Promise<void>) | null = null;

export function initAlerter(chatId: string, telegramSend: (chatId: string, message: string) => Promise<unknown>): void {
  sendAlert = async (message: string) => {
    try {
      await telegramSend(chatId, message);
    } catch (err) {
      logger.error('Failed to send Telegram alert', { error: err });
    }
  };
}

export async function alert(message: string): Promise<void> {
  logger.error(`ALERT: ${message}`);

  if (!sendAlert) return;

  if (isRateLimited()) {
    if (suppressedCount === 1) {
      logger.warn(`Alert rate limited. Suppressing further alerts this hour.`);
    }
    return;
  }

  // If we have suppressed alerts, include the count
  let fullMessage = `⚠️ ${message}`;
  if (suppressedCount > 0) {
    fullMessage += `\n\n(${suppressedCount} weitere Alerts unterdrueckt in der letzten Stunde)`;
    suppressedCount = 0;
  }

  await sendAlert(fullMessage);
}

export async function alertScraperError(scraperName: string, error: unknown): Promise<void> {
  const msg = error instanceof Error ? error.message : String(error);
  await alert(`${scraperName} Scraper fehlgeschlagen: ${msg}`);
}

export async function alertApiError(service: string, status: number | string, message: string): Promise<void> {
  await alert(`${service} API Error: ${status} ${message}`);
}

export async function alertMailError(email: string, error: unknown): Promise<void> {
  const msg = error instanceof Error ? error.message : String(error);
  await alert(`Mail an ${email} fehlgeschlagen: ${msg}`);
}
