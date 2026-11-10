import { ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Request } from 'express';

export function verifyWebhook(req: Request & {rawBody?: Buffer}, secret: string) {
  if (!secret) throw new ServiceUnavailableException('Webhook is not configured');
  const timestamp = req.get('x-pingcode-timestamp') || '', signature = req.get('x-pingcode-signature') || '';
  if (!/^\d{10,11}$/.test(timestamp) || Math.abs(Date.now() / 1000 - Number(timestamp)) > 300 ||
      !/^sha256=[a-f0-9]{64}$/i.test(signature) || !req.rawBody) throw new UnauthorizedException('Invalid webhook signature or timestamp');
  const expected = createHmac('sha256', secret).update(timestamp + '.').update(req.rawBody).digest();
  if (!timingSafeEqual(expected, Buffer.from(signature.slice(7), 'hex'))) throw new UnauthorizedException('Invalid webhook signature or timestamp');
}
