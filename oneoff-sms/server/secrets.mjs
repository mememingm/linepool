import { randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export function loadLocalSecrets() {
  if (process.env.ONCE_ADMIN_TOKEN && process.env.ONCE_MOCK_WEBHOOK_SECRET) return { adminToken: process.env.ONCE_ADMIN_TOKEN, webhookSecret: process.env.ONCE_MOCK_WEBHOOK_SECRET };
  const directory = fileURLToPath(new URL('../data/', import.meta.url));
  mkdirSync(directory, { recursive: true });
  const path = `${directory}/local-secrets.json`;
  try {
    writeFileSync(path, JSON.stringify({ adminToken: randomBytes(24).toString('hex'), webhookSecret: randomBytes(32).toString('hex') }, null, 2), { flag: 'wx', mode: 0o600 });
  } catch (error) { if (error.code !== 'EEXIST') throw error; }
  const saved = JSON.parse(readFileSync(path, 'utf8'));
  const result = { adminToken: process.env.ONCE_ADMIN_TOKEN || saved.adminToken, webhookSecret: process.env.ONCE_MOCK_WEBHOOK_SECRET || saved.webhookSecret };
  if (!result.adminToken || !result.webhookSecret) throw new Error('Local test credentials are missing.');
  return result;
}
