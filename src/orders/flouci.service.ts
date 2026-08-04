import {
  BadRequestException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

interface FlouciGenerateResult {
  success?: boolean;
  payment_id?: string;
  link?: string;
  developer_tracking_id?: string;
  status?: number;
  message?: string;
}

interface FlouciGenerateResponse {
  result?: FlouciGenerateResult;
  code?: number;
  detail?: string;
  message?: string;
}

interface FlouciVerifyResponse {
  success?: boolean;
  result?: {
    status?: string;
    amount?: number;
    developer_tracking_id?: string;
  };
}

@Injectable()
export class FlouciService {
  private readonly logger = new Logger(FlouciService.name);
  private readonly apiBase = 'https://developers.flouci.com/api/v2';

  constructor(private readonly configService: ConfigService) {}

  private getKeys() {
    const publicKey = (this.configService.get<string>('FLOUCI_PUBLIC_KEY') ?? '')
      .trim()
      .replace(/^["']|["']$/g, '');
    const secretKey = (this.configService.get<string>('FLOUCI_SECRET_KEY') ?? '')
      .trim()
      .replace(/^["']|["']$/g, '');

    if (!publicKey || !secretKey) {
      throw new ServiceUnavailableException(
        'Flouci keys missing. Set FLOUCI_PUBLIC_KEY and FLOUCI_SECRET_KEY in para-shop+backend/.env then restart the backend.',
      );
    }

    return { publicKey, secretKey };
  }

  private getAuthHeader() {
    const { publicKey, secretKey } = this.getKeys();
    return `Bearer ${publicKey}:${secretKey}`;
  }

  async generatePayment(input: {
    amountMillimes: number;
    trackingId: string;
    clientLabel: string;
    successLink: string;
    failLink: string;
    webhookUrl?: string;
  }) {
    const body: Record<string, unknown> = {
      amount: String(input.amountMillimes),
      developer_tracking_id: input.trackingId,
      accept_card: true,
      success_link: input.successLink,
      fail_link: input.failLink,
      client_id: input.clientLabel.slice(0, 120),
    };

    // Flouci cannot call localhost webhooks — skip in local dev
    if (
      input.webhookUrl &&
      !/localhost|127\.0\.0\.1/i.test(input.webhookUrl)
    ) {
      body.webhook = input.webhookUrl;
    }

    let response: Response;
    let rawText = '';
    try {
      response = await fetch(`${this.apiBase}/generate_payment`, {
        method: 'POST',
        headers: {
          Authorization: this.getAuthHeader(),
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify(body),
      });
      rawText = await response.text();
    } catch (error) {
      const detail =
        error instanceof Error
          ? `${error.message}${error.cause ? ` (${String(error.cause)})` : ''}`
          : String(error);
      this.logger.error(`Flouci generate_payment network error: ${detail}`);
      throw new ServiceUnavailableException(
        `Could not reach Flouci payment service: ${detail}`,
      );
    }

    let data: FlouciGenerateResponse = {};
    try {
      data = rawText ? (JSON.parse(rawText) as FlouciGenerateResponse) : {};
    } catch {
      this.logger.warn(`Flouci non-JSON response (${response.status}): ${rawText.slice(0, 300)}`);
      throw new BadRequestException(
        `Flouci returned an unexpected response (HTTP ${response.status})`,
      );
    }

    const result = data.result;

    if (!response.ok || !result?.success || !result.payment_id || !result.link) {
      const message =
        result?.message ||
        data.detail ||
        data.message ||
        `Flouci could not create the payment session (HTTP ${response.status})`;
      this.logger.warn(`Flouci generate_payment failed: ${JSON.stringify(data)}`);
      throw new BadRequestException(message);
    }

    return {
      paymentId: result.payment_id,
      link: result.link,
    };
  }

  async verifyPayment(paymentId: string) {
    let response: Response;
    let rawText = '';
    try {
      response = await fetch(`${this.apiBase}/verify_payment/${paymentId}`, {
        method: 'GET',
        headers: {
          Authorization: this.getAuthHeader(),
          Accept: 'application/json',
        },
      });
      rawText = await response.text();
    } catch (error) {
      const detail =
        error instanceof Error
          ? `${error.message}${error.cause ? ` (${String(error.cause)})` : ''}`
          : String(error);
      this.logger.error(`Flouci verify_payment network error: ${detail}`);
      throw new ServiceUnavailableException(
        `Could not reach Flouci payment service: ${detail}`,
      );
    }

    let data: FlouciVerifyResponse = {};
    try {
      data = rawText ? (JSON.parse(rawText) as FlouciVerifyResponse) : {};
    } catch {
      throw new BadRequestException(
        `Flouci verify returned an unexpected response (HTTP ${response.status})`,
      );
    }

    const status = data.result?.status ?? '';
    const success = Boolean(data.success) && status === 'SUCCESS';

    return {
      success,
      status,
      amountMillimes: data.result?.amount ?? null,
      trackingId: data.result?.developer_tracking_id ?? null,
      raw: data,
    };
  }
}
