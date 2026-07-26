import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly transporter: Transporter | null;
  private readonly from: string;
  private readonly frontendUrl: string;

  constructor(private readonly configService: ConfigService) {
    const host = this.configService.get<string>('MAIL_HOST');
    const port = Number(this.configService.get('MAIL_PORT') ?? 587);
    const user = this.configService.get<string>('MAIL_USER');
    const pass = this.configService.get<string>('MAIL_PASS')?.replace(/\s+/g, '');

    this.from =
      this.configService.get<string>('MAIL_FROM') ??
      `ParaShop+ <${user ?? 'noreply@parashop.local'}>`;
    this.frontendUrl =
      this.configService.get<string>('FRONTEND_URL') ?? 'http://localhost:5173';

    if (!host || !user || !pass) {
      this.transporter = null;
      this.logger.warn(
        'Mail is not configured (MAIL_HOST / MAIL_USER / MAIL_PASS). Emails will be skipped.',
      );
      return;
    }

    this.transporter = nodemailer.createTransport({
      host,
      port,
      secure: port === 465,
      auth: { user, pass },
    });
  }

  async sendNotificationEmail(input: {
    to: string;
    title: string;
    message: string;
    link?: string | null;
  }) {
    if (!this.transporter) return;

    const actionUrl = input.link
      ? `${this.frontendUrl}${input.link.startsWith('/') ? '' : '/'}${input.link}`
      : this.frontendUrl;

    const html = `
      <div style="font-family:Arial,Helvetica,sans-serif;background:#f5f3ff;padding:24px;">
        <div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:16px;padding:28px;border:1px solid #e9d5ff;">
          <p style="margin:0 0 8px;font-size:14px;color:#8b5cf6;font-weight:700;">ParaShop+</p>
          <h1 style="margin:0 0 12px;font-size:22px;color:#1f2937;">${escapeHtml(input.title)}</h1>
          <p style="margin:0 0 20px;font-size:15px;line-height:1.5;color:#6b7280;">${escapeHtml(input.message)}</p>
          <a href="${actionUrl}" style="display:inline-block;background:#8b5cf6;color:#ffffff;text-decoration:none;padding:12px 18px;border-radius:12px;font-weight:600;font-size:14px;">
            Open ParaShop+
          </a>
          <p style="margin:24px 0 0;font-size:12px;color:#9ca3af;">
            You received this email because of activity on your ParaShop+ account.
          </p>
        </div>
      </div>
    `;

    try {
      await this.transporter.sendMail({
        from: this.from,
        to: input.to,
        subject: input.title,
        text: `${input.message}\n\n${actionUrl}`,
        html,
      });
    } catch (error) {
      this.logger.error(
        `Failed to send email to ${input.to}`,
        error instanceof Error ? error.stack : undefined,
      );
    }
  }
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
