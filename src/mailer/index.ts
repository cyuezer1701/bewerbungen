import nodemailer from 'nodemailer';
import path from 'node:path';
import fs from 'node:fs';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import { withRetry } from '../utils/retry.js';
import { alertMailError } from '../utils/alerter.js';
import { isTestMode, getTestEmail } from '../utils/test-mode.js';
import { buildApplicationEmail } from './templates.js';
import type { JobRow, ApplicationRow } from '../db/queries.js';

function createTransporter() {
  return nodemailer.createTransport({
    host: config.SMTP_HOST,
    port: config.SMTP_PORT,
    secure: config.SMTP_PORT === 465,
    auth: {
      user: config.SMTP_USER,
      pass: config.SMTP_PASS,
    },
  });
}

export async function sendApplicationEmail(
  job: JobRow,
  app: ApplicationRow,
  targetEmail: string
): Promise<{ actualRecipient: string; testMode: boolean }> {
  if (!config.SMTP_USER || !config.SMTP_PASS) {
    throw new Error('SMTP not configured. Set SMTP_USER and SMTP_PASS in .env');
  }

  const testMode = isTestMode();
  const testEmail = getTestEmail();
  const actualRecipient = testMode && testEmail ? testEmail : targetEmail;

  const { getSetting } = await import('../db/settings.js');
  const senderPhone = getSetting('sender_phone') || '';

  const { subject, text, html } = buildApplicationEmail(
    job,
    config.SENDER_NAME,
    config.SENDER_EMAIL,
    senderPhone,
    testMode ? targetEmail : undefined
  );

  const finalSubject = testMode ? `[TEST] ${subject}` : subject;

  const attachmentPath = app.full_package_pdf_path || app.cover_letter_pdf_path;
  if (!attachmentPath || !fs.existsSync(attachmentPath)) {
    throw new Error('No PDF found for this application. Generate PDFs first with /apply.');
  }

  const attachmentFilename = path.basename(attachmentPath);
  const transporter = createTransporter();

  if (testMode) {
    logger.info(`TEST MODE: Mail umgeleitet von ${targetEmail} an ${actualRecipient}`);
  }

  await withRetry(async () => {
    const info = await transporter.sendMail({
      from: `"${config.SENDER_NAME}" <${config.SENDER_EMAIL}>`,
      to: actualRecipient,
      bcc: config.SENDER_EMAIL,
      subject: finalSubject,
      text,
      html,
      attachments: [
        {
          filename: attachmentFilename,
          path: attachmentPath,
        },
      ],
    });

    logger.info(`Email sent to ${actualRecipient}: ${info.messageId}${testMode ? ' (TEST MODE)' : ''}`);
  }, {
    maxRetries: 2,
    baseDelayMs: 3000,
    retryOn: (err) => {
      const msg = err.message.toLowerCase();
      return !msg.includes('auth') && !msg.includes('invalid') && !msg.includes('rejected');
    },
  }).catch(async (err) => {
    await alertMailError(actualRecipient, err);
    throw err;
  });

  return { actualRecipient, testMode };
}
