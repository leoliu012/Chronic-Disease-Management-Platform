import { Injectable, Logger } from '@nestjs/common';
import * as crypto from 'crypto';

export type SmsSendInput = {
  hospitalTenantId?: string | null;
  phone: string;
  content: string;
  templateId?: string;
};

export type SmsSendResult = {
  success: boolean;
  providerMessageId?: string;
  errorMessage?: string;
  mocked: boolean;
};

/**
 * SmsService — provider adapter
 *
 * - dev / SMS_MOCK=true: 直接 mock 成功; 不真实调用 SaaS.
 * - 生产模式通过 SMS_PROVIDER 切换; v2 patch 不引入真实接入, 留给后续.
 *
 * Note: 短信也可以做 per-tenant 签名 / 模板, 当前先保留全局 SMS_MOCK; 真实接入时
 * 再 extend 到 per-tenant config.
 */
@Injectable()
export class SmsService {
  private readonly logger = new Logger(SmsService.name);

  isMock(): boolean {
    return String(process.env.SMS_MOCK || 'true').toLowerCase() === 'true';
  }

  async send(input: SmsSendInput): Promise<SmsSendResult> {
    if (this.isMock()) {
      const providerMessageId =
        'mock-sms-' +
        crypto
          .createHash('sha1')
          .update(`${input.phone}:${Date.now()}`)
          .digest('hex')
          .slice(0, 16);
      this.logger.log(
        `[mock-sms] tenant=${input.hospitalTenantId ?? '-'} -> ${this.maskPhone(input.phone)} :: ${input.content.slice(0, 40)}...`,
      );
      return { success: true, providerMessageId, mocked: true };
    }
    return {
      success: false,
      errorMessage: 'SMS provider not configured (set SMS_MOCK=true for dev).',
      mocked: false,
    };
  }

  maskPhone(value?: string | null): string {
    if (!value) return '';
    const digits = String(value).replace(/\D/g, '');
    if (digits.length < 7) return String(value);
    return value.replace(/(\d{3})\d+(\d{4})/, '$1****$2');
  }
}
