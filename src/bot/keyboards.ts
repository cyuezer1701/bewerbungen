import { Markup } from 'telegraf';

export function jobListKeyboard(jobId: string) {
  return Markup.inlineKeyboard([
    Markup.button.callback('Details', `details_${jobId}`),
    Markup.button.callback('Bewerben', `apply_${jobId}`),
    Markup.button.callback('Skip', `skip_${jobId}`),
  ]);
}

export function afterGeneratePortalKeyboard(jobId: string) {
  return Markup.inlineKeyboard([
    Markup.button.callback('Preview', `preview_${jobId}`),
    Markup.button.callback('PDF herunterladen', `pdf_${jobId}`),
    Markup.button.callback('Bearbeiten', `edit_${jobId}`),
  ]);
}

export function afterGenerateEmailKeyboard(jobId: string) {
  return Markup.inlineKeyboard([
    Markup.button.callback('Preview', `preview_${jobId}`),
    Markup.button.callback('Per Mail senden', `send_${jobId}`),
    Markup.button.callback('Bearbeiten', `edit_${jobId}`),
  ]);
}

export function afterGenerateBothKeyboard(jobId: string) {
  return Markup.inlineKeyboard([
    Markup.button.callback('Per Mail senden', `send_${jobId}`),
    Markup.button.callback('Portal + PDF', `pdf_${jobId}`),
    Markup.button.callback('Bearbeiten', `edit_${jobId}`),
  ]);
}

export function afterSendKeyboard(jobId: string) {
  return Markup.inlineKeyboard([
    Markup.button.callback('Interview erhalten', `status_${jobId}_interview`),
    Markup.button.callback('Absage erhalten', `status_${jobId}_rejected`),
    Markup.button.callback('Angebot erhalten', `status_${jobId}_offer`),
  ]);
}

export function followUpKeyboard(jobId: string) {
  return Markup.inlineKeyboard([
    Markup.button.callback('Status updaten', `update_${jobId}`),
    Markup.button.callback('Nachfassen', `followup_${jobId}`),
    Markup.button.callback('Archivieren', `archive_${jobId}`),
  ]);
}
