import nodemailer from 'nodemailer';
import path from 'node:path';
import fs from 'node:fs';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import { withRetry } from '../utils/retry.js';
import { alertMailError } from '../utils/alerter.js';
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
): Promise<void> {
  if (!config.SMTP_USER || !config.SMTP_PASS) {
    throw new Error('SMTP not configured. Set SMTP_USER and SMTP_PASS in .env');
  }

  const { subject, text, html } = buildApplicationEmail(
    job,
    config.SENDER_NAME,
    config.SENDER_EMAIL
  );

  // Determine attachment: prefer full package, fall back to cover letter only
  const attachmentPath = app.full_package_pdf_path || app.cover_letter_pdf_path;
  if (!attachmentPath || !fs.existsSync(attachmentPath)) {
    throw new Error('No PDF found for this application. Generate PDFs first with /apply.');
  }

  const attachmentFilename = path.basename(attachmentPath);

  const transporter = createTransporter();

  await withRetry(async () => {
    const info = await transporter.sendMail({
      from: `"${config.SENDER_NAME}" <${config.SENDER_EMAIL}>`,
      to: targetEmail,
      bcc: config.SENDER_EMAIL,
      subject,
      text,
      html,
      attachments: [
        {
          filename: attachmentFilename,
          path: attachmentPath,
        },
      ],
    });

    logger.info(`Email sent to ${targetEmail}: ${info.messageId}`);
  }, {
    maxRetries: 2,
    baseDelayMs: 3000,
    retryOn: (err) => {
      // Don't retry on auth errors or invalid recipients
      const msg = err.message.toLowerCase();
      return !msg.includes('auth') && !msg.includes('invalid') && !msg.includes('rejected');
    },
  }).catch(async (err) => {
    await alertMailError(targetEmail, err);
    throw err;
  });
}
