import { Injectable } from '@nestjs/common';
import { DbService } from './db.service';
import { PingcodeClient, normalizePhone, PcNumber } from './pingcode.client';
import { settings } from './config';
import { fingerprint, lockPhone, lockUser, transactionOptions } from './business';

const pendingAssignment = 'OPERATOR_ASSIGNMENT_REQUIRED';
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected a JSON object');
  return value as Record<string, unknown>;
}
function text(value: unknown, field: string, max = 120): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new Error('Invalid ' + field);
  return value.trim();
}
function instant(value: unknown, field: string): Date {
  const input = text(value, field);
  if (!/(?:Z|[+-]\d{2}:\d{2})$/.test(input) || !Number.isFinite(Date.parse(input))) throw new Error('Invalid ' + field);
  return new Date(input);
}
function numberId(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) <= 0) throw new Error('Invalid numberId');
  return Number(value);
}
function resource(row: PcNumber, now: Date) {
  return {providerStatus: row.status, resourceExpiresAt: row.expiresAt ? new Date(row.expiresAt) : null, lastSyncedAt: now};
}
function identity(id: number) {
  return {provider: 'pingcode', providerAccountId: settings.pingcode.accountId, providerNumberId: String(id)};
}

// Trusted operator CLI and guarded admin integration API. No C-end route exposes import or assignment.
@Injectable()
export class OperatorService {
  constructor(private readonly db: DbService, private readonly pc: PingcodeClient) {}
  async check() {
    const account = await this.pc.verifyAccount(['numbers:read', 'sms:read', 'sms:send']);
    return {accountId: String(account.id), username: account.username, scopes: account.scopes,
      receiveWebhookConfigured: Boolean(settings.pingcode.receiveWebhookSecret), sendStatusMode: 'polling',
      receiveWebhookPath: '/api/webhooks/pingcode/receive'};
  }
  async sync(input: unknown = []) {
    if (!Array.isArray(input) || input.length > 1000) throw new Error('Import file must be an array of at most 1000 number metadata objects');
    const metadata = input.map(value => {
      const row = record(value);
      const countryCode = text(row.countryCode, 'countryCode');
      if (!/^[A-Z]{2}$/.test(countryCode)) throw new Error('countryCode must be a two-letter uppercase country code');
      return {numberId: numberId(row.numberId), countryCode, countryName: text(row.countryName, 'countryName'),
        regionId: text(row.regionId, 'regionId'), regionName: text(row.regionName, 'regionName')};
    });
    if (new Set(metadata.map(row => row.numberId)).size !== metadata.length) throw new Error('Duplicate import numberId');
    await this.pc.verifyAccount(['numbers:read']);
    // Fetch and validate every page before making any database changes.
    const upstream = await this.pc.numbers(), byId = new Map(upstream.map(row => [row.id, row]));
    for (const row of metadata) if (!byId.get(row.numberId)?.phoneNumber) throw new Error('Import number is not visible or has no phoneNumber: ' + row.numberId);
    const now = new Date();
    return this.db.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${settings.pingcode.accountId + ':operator:sync'},0))`;
      const mapped = await tx.phoneNumber.findMany({where: {provider: 'pingcode', providerAccountId: settings.pingcode.accountId}, orderBy: {id: 'asc'}});
      for (const phone of mapped) {
        await lockPhone(tx, phone.id);
        const remote = byId.get(Number(phone.providerNumberId));
        if (remote?.phoneNumber && normalizePhone(remote.phoneNumber) !== normalizePhone(phone.number))
          throw new Error('Provider number identity changed; manual investigation required: ' + phone.providerNumberId);
        await tx.phoneNumber.update({where: {id: phone.id}, data: remote
          ? resource(remote, now) : {providerStatus: 'UNAVAILABLE', lastSyncedAt: now}});
      }
      const allPhones = await tx.phoneNumber.findMany({select: {number: true}});
      const knownPhones = new Set(allPhones.map(row => normalizePhone(row.number)));
      let imported = 0;
      for (const row of metadata) {
        if (mapped.some(phone => phone.providerNumberId === String(row.numberId))) continue;
        const remote = byId.get(row.numberId)!;
        const number = normalizePhone(remote.phoneNumber!);
        if (knownPhones.has(number)) throw new Error('Phone number already belongs to another local resource: ' + row.numberId);
        const {numberId: _id, ...location} = row;
        await tx.phoneNumber.create({data: {...identity(row.numberId), ...location, number: '+' + number,
          ...resource(remote, now), occupied: false, holdReason: pendingAssignment, smsEnabled: true}});
        knownPhones.add(number); imported++;
      }
      const mappedIds = new Set([...mapped.map(row => Number(row.providerNumberId)), ...metadata.map(row => row.numberId)]);
      return {accountId: settings.pingcode.accountId, refreshed: mapped.length, imported,
        unavailable: mapped.filter(row => !byId.has(Number(row.providerNumberId))).length,
        unimported: upstream.filter(row => !mappedIds.has(row.id)).map(row => ({numberId: row.id, phoneNumber: row.phoneNumber || null, status: row.status})),
        syncedAt: now};
    }, transactionOptions);
  }
  async assign(input: unknown) {
    const row = record(input);
    const id = numberId(row.numberId), userEmail = text(row.userEmail, 'userEmail', 254).toLowerCase();
    const reference = text(row.reference, 'reference', 128);
    if (!/^[a-zA-Z0-9_-]{16,128}$/.test(reference)) throw new Error('reference must contain 16-128 letters, digits, underscores or hyphens');
    const startedAt = instant(row.startedAt, 'startedAt'), expiresAt = instant(row.expiresAt, 'expiresAt');
    if (![7, 30].includes(Number(row.termDays)) || typeof row.termDays !== 'number' || +expiresAt - +startedAt !== Number(row.termDays) * 86400000)
      throw new Error('termDays must be 7 or 30 and match the explicit service interval');
    if (!Number.isSafeInteger(row.priceMinor) || Number(row.priceMinor) < 0 || Number(row.priceMinor) > 2147483647) throw new Error('Invalid priceMinor');
    const currency = text(row.currency, 'currency');
    if (!/^[A-Z]{3}$/.test(currency)) throw new Error('currency must be a three-letter uppercase currency code');
    const requestHash = fingerprint({id, userEmail, startedAt: startedAt.toISOString(), expiresAt: expiresAt.toISOString(), termDays: row.termDays, priceMinor: row.priceMinor, currency});
    await this.check();
    const remote = (await this.pc.numbers()).find(item => item.id === id);
    if (!remote?.phoneNumber) throw new Error('Number is not visible to the configured operator account');
    const user = await this.db.user.findUnique({where: {email: userEmail}});
    if (!user) throw new Error('ONCE user not found');
    return this.db.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${settings.pingcode.accountId + ':assignment:' + reference},0))`;
      await lockUser(tx, user.id);
      const phone = await tx.phoneNumber.findUnique({where: {provider_providerAccountId_providerNumberId: identity(id)}});
      if (!phone) throw new Error('Import this number before assigning it');
      await lockPhone(tx, phone.id);
      const previous = await tx.auditLog.findFirst({where: {action: 'PC_NUMBER_ASSIGNED', AND: [
        {details: {path: ['accountId'], equals: settings.pingcode.accountId}}, {details: {path: ['reference'], equals: reference}}]}});
      if (previous) {
        const details = record(previous.details);
        if (details.requestHash !== requestHash) throw new Error('Assignment reference was already used with different details');
        return {leaseId: previous.resourceId, userId: previous.userId, numberId: id, duplicate: true};
      }
      const current = await tx.phoneNumber.findUniqueOrThrow({where: {id: phone.id}});
      if (normalizePhone(remote.phoneNumber!) !== normalizePhone(current.number)) throw new Error('Provider number identity mismatch');
      if (current.occupied || current.holdReason !== pendingAssignment || await tx.lease.count({where: {phoneNumberId: phone.id}}))
        throw new Error('Only an unassigned imported number may be assigned; release/reassignment rules remain pending');
      const now = new Date();
      if (expiresAt <= now || startedAt > now) throw new Error('Assignment must include the current time');
      if (remote.status !== 'ACTIVE' || !remote.expiresAt || new Date(remote.expiresAt) < expiresAt || !current.smsEnabled)
        throw new Error('Number must be ACTIVE with confirmed SMS/resource coverage for the entire assignment');
      await tx.phoneNumber.update({where: {id: phone.id}, data: {...resource(remote, now), occupied: true, holdReason: null}});
      const lease = await tx.lease.create({data: {userId: user.id, phoneNumberId: phone.id, startedAt, expiresAt,
        termDays: Number(row.termDays), priceMinor: Number(row.priceMinor), currency}});
      await tx.auditLog.create({data: {userId: user.id, action: 'PC_NUMBER_ASSIGNED', resourceId: lease.id,
        details: {source: 'operator-cli', accountId: settings.pingcode.accountId, numberId: id, reference, requestHash,
          startedAt: startedAt.toISOString(), expiresAt: expiresAt.toISOString(), termDays: Number(row.termDays), priceMinor: Number(row.priceMinor), currency}}});
      // Events received before the explicit assignment can now be attributed by historical time.
      await tx.webhookEvent.updateMany({where: {...identity(id), status: 'UNMATCHED', occurredAt: {gte: startedAt, lt: expiresAt}},
        data: {attempts: 0, nextAttemptAt: now}});
      return {leaseId: lease.id, userId: user.id, numberId: id, duplicate: false};
    }, transactionOptions);
  }
}
