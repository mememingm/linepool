import 'reflect-metadata';
import { config } from 'dotenv';
import { resolve } from 'node:path';

export const environmentPath = resolve(process.env.ONCE_ENV_FILE || resolve(__dirname, '../.env'));
config({ path: environmentPath, quiet: true });
const port = Number(process.env.PORT || 3000);
const production = process.env.NODE_ENV === 'production';
const demo = process.env.DEMO_MODE === 'true';
const origin = process.env.APP_ORIGIN || 'http://127.0.0.1:3000';
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid PORT');
if (new URL(origin).origin !== origin) throw new Error('APP_ORIGIN must be an origin without a path');
if (production && demo) throw new Error('DEMO_MODE must be false in production');
if (production && !origin.startsWith('https://')) throw new Error('Production APP_ORIGIN must use HTTPS');

// LAN development must also support opening the same server on this computer.
// Keep production restricted to its configured origin and never trust request Host.
const allowedOrigins = new Set([origin]);
if (!production) {
  for (const hostname of ['127.0.0.1', 'localhost', '[::1]']) {
    allowedOrigins.add(`http://${hostname}:${port}`);
  }
}

const pcBaseUrl = (process.env.PINGCODE_BASE_URL || '').replace(/\/+$/, '');
if (pcBaseUrl) {
  const pcUrl = new URL(pcBaseUrl);
  if (!['http:', 'https:'].includes(pcUrl.protocol) || pcUrl.username || pcUrl.password || pcUrl.search || pcUrl.hash ||
      (production && pcUrl.protocol !== 'https:')) throw new Error('Invalid PINGCODE_BASE_URL');
}
export const settings = {
  port, production, demo, origin, allowedOrigins, host: process.env.HOST || '127.0.0.1',
  pingcode: {
    baseUrl: pcBaseUrl,
    accountId: process.env.PINGCODE_ACCOUNT_ID || '',
    apiKey: process.env.PINGCODE_API_KEY || '',
    sendWebhookSecret: process.env.PINGCODE_SEND_WEBHOOK_SECRET || '',
    receiveWebhookSecret: process.env.PINGCODE_RECEIVE_WEBHOOK_SECRET || '',
  },
};
