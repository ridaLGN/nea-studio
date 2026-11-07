import nodemailer, { type Transporter } from 'nodemailer';
import type { NotificationChannel, NotificationType } from '@prisma/client';
import { env } from '../../config/env.js';
import { prisma, logger, isUniqueViolation } from '../../lib/core.js';
import { formatLocal } from '../../lib/time.js';
import { getSettings } from '../settings/settings.service.js';

// ---------- Providers ----------
// A provider reports whether it is configured. When it is not, the notification is stored
// with status NOT_CONFIGURED — we never pretend a message was sent.

interface SendResult {
  providerMessageId?: string;
}
interface Provider {
  channel: NotificationChannel;
  configured(): boolean;
  send(to: string, subject: string, body: string): Promise<SendResult>;
}

let transporter: Transporter | null = null;
const emailProvider: Provider = {
  channel: 'EMAIL',
  configured: () => !!env.SMTP_HOST,
  async send(to, subject, body) {
    transporter ??= nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: env.SMTP_SECURE === 'true',
      auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASSWORD } : undefined,
    });
    const info = await transporter.sendMail({ from: env.MAIL_FROM, to, subject, text: body });
    return { providerMessageId: info.messageId };
  },
};

const whatsappProvider: Provider = {
  channel: 'WHATSAPP',
  configured: () => !!(env.WHATSAPP_ACCESS_TOKEN && env.WHATSAPP_PHONE_NUMBER_ID && env.WHATSAPP_TEMPLATE_NAME),
  async send(to, _subject, body) {
    // Business-initiated WhatsApp messages must use a pre-approved template.
    // The template is expected to have a single body parameter {{1}} receiving the message text.
    const res = await fetch(`https://graph.facebook.com/${env.WHATSAPP_API_VERSION}/${env.WHATSAPP_PHONE_NUMBER_ID}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.WHATSAPP_ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: to.replace('+', ''),
        type: 'template',
        template: {
          name: env.WHATSAPP_TEMPLATE_NAME,
          language: { code: env.WHATSAPP_TEMPLATE_LANG },
          components: [{ type: 'body', parameters: [{ type: 'text', text: body.slice(0, 1000) }] }],
        },
      }),
    });
    const json = (await res.json().catch(() => ({}))) as { messages?: { id: string }[]; error?: { message: string } };
    if (!res.ok) throw new Error(json.error?.message ?? `WhatsApp API HTTP ${res.status}`);
    return { providerMessageId: json.messages?.[0]?.id };
  },
};

export const providers: Provider[] = [emailProvider, whatsappProvider];
export const providerStatus = () => providers.map((p) => ({ channel: p.channel, configured: p.configured() }));

// ---------- Templates ----------
export interface NotifyData {
  customerName: string;
  serviceName?: string;
  employeeName?: string;
  startAt?: Date;
  reference?: string;
  discountPercent?: number;
  expiresAt?: Date | null;
  reason?: string | null;
}

function render(type: NotificationType, d: NotifyData, salon: { name: string; tz: string; phone?: string | null }) {
  const when = d.startAt ? formatLocal(d.startAt, salon.tz) : '';
  const sign = `\n\n${salon.name}${salon.phone ? ' · ' + salon.phone : ''}`;
  const manage = d.reference ? `\nManage your booking: ${env.PUBLIC_APP_URL}/booking/manage?ref=${d.reference}` : '';
  switch (type) {
    case 'APPOINTMENT_CONFIRMATION':
      return { subject: `Your appointment at ${salon.name} — ${d.reference}`, body: `Hello ${d.customerName},\n\nYour appointment is booked: ${d.serviceName} with ${d.employeeName} on ${when}.\nReference: ${d.reference}${manage}${sign}` };
    case 'APPOINTMENT_REMINDER':
      return { subject: `Reminder: ${d.serviceName} on ${when}`, body: `Hello ${d.customerName},\n\nA gentle reminder of your appointment: ${d.serviceName} with ${d.employeeName} on ${when}.${manage}${sign}` };
    case 'APPOINTMENT_CANCELLATION':
      return { subject: `Appointment cancelled — ${d.reference}`, body: `Hello ${d.customerName},\n\nYour appointment ${d.reference} (${d.serviceName}, ${when}) has been cancelled.${d.reason ? '\nReason: ' + d.reason : ''}${sign}` };
    case 'APPOINTMENT_RESCHEDULED':
      return { subject: `Appointment rescheduled — ${d.reference}`, body: `Hello ${d.customerName},\n\nYour appointment ${d.reference} has been moved to ${when} with ${d.employeeName} (${d.serviceName}).${manage}${sign}` };
    case 'REWARD_UNLOCKED':
      return { subject: `You unlocked a ${d.discountPercent}% reward`, body: `Hello ${d.customerName},\n\nThank you for your loyalty! A ${d.discountPercent}% discount is now available on your NÉA card${d.expiresAt ? ' until ' + formatLocal(d.expiresAt, salon.tz, 'd LLLL yyyy') : ''}.${sign}` };
    case 'REWARD_EXPIRING':
      return { subject: `Your ${d.discountPercent}% reward expires soon`, body: `Hello ${d.customerName},\n\nYour ${d.discountPercent}% loyalty reward expires on ${d.expiresAt ? formatLocal(d.expiresAt, salon.tz, 'd LLLL yyyy') : ''}. Book your next visit to enjoy it.${sign}` };
  }
}

// ---------- Dispatcher ----------
export async function notify(args: { type: NotificationType; customerId: string; appointmentId?: string; data: NotifyData; dedupeKey?: string }) {
  const [customer, settings] = await Promise.all([prisma.customer.findUnique({ where: { id: args.customerId } }), getSettings()]);
  if (!customer) return;
  const { subject, body } = render(args.type, args.data, { name: settings.name, tz: settings.timezone, phone: settings.phone });

  for (const provider of providers) {
    const recipient = provider.channel === 'EMAIL' ? customer.email : customer.phone;
    if (!recipient) continue;
    let row;
    try {
      row = await prisma.notification.create({
        data: {
          channel: provider.channel,
          type: args.type,
          recipient,
          subject,
          body,
          customerId: customer.id,
          appointmentId: args.appointmentId,
          dedupeKey: args.dedupeKey ? `${args.dedupeKey}:${provider.channel}` : undefined,
          status: provider.configured() ? 'QUEUED' : 'NOT_CONFIGURED',
          error: provider.configured() ? null : `${provider.channel} integration is not configured`,
        },
      });
    } catch (e) {
      if (isUniqueViolation(e)) continue; // already sent (dedupe)
      throw e;
    }
    if (row.status !== 'QUEUED') continue;
    try {
      const r = await provider.send(recipient, subject, body);
      await prisma.notification.update({ where: { id: row.id }, data: { status: 'SENT', sentAt: new Date(), providerMessageId: r.providerMessageId } });
    } catch (e) {
      logger.warn({ err: e, channel: provider.channel }, 'notification delivery failed');
      await prisma.notification.update({ where: { id: row.id }, data: { status: 'FAILED', error: String((e as Error).message).slice(0, 500) } });
    }
  }
}

/** Fire-and-forget wrapper: notification failures must never break a booking. */
export function notifyLater(args: Parameters<typeof notify>[0]) {
  notify(args).catch((e) => logger.error({ err: e }, 'notify failed'));
}
