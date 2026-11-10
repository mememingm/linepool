import { rechargeRulesSchema } from '@linepool/contracts';
import { id, record, text as s } from './model.js';
import { ImportPlan } from './plan.js';

export async function planAdministration(b: ImportPlan): Promise<void> {
  await b.each('AuditLog', async row => {
    const targetId = b.mapped('AuditLog', id(row));
    if (await b.fact('AuditLog', row, targetId)) b.write('AuditLog', row, 'admin_audit', { id: targetId, actor_id: b.mapped('User', row.userId), action: row.action, target_id: row.resourceId, reason: row.reason || 'Historical source audit (original reason unknown)', before_data: null, after_data: { source: row, sourceSystem: b.decisions.sourceSystem }, created_at: row.createdAt });
  });
  await b.each('AdminIdempotency', async row => {
    // Legacy hashes may cover erased fields or passwords; retain completed facts without
    // reconstructing secrets or making an old administrative request executable again.
    const decision = b.decisions.adminOperations[id(row)] ?? null;
    if (decision) b.evidence(decision.evidence);
    await b.fact('AdminIdempotency', row, b.mapped('AdminIdempotency', id(row)), decision, { historicalOnly: true });
  });
  await b.each('AppSetting', async row => {
    const sourceId = b.decisions.settingIds[s(row.key)];
    if (!sourceId) throw new Error('Text setting needs an explicit stable UUID import identity');
    const setting = b.decisions.settings;
    if (!setting) throw new Error('Importing actual settings requires explicit actor/conversion decisions');
    if (!b.rows('users').some(u => u.id === setting.actorId && u.role === 'ADMIN' && u.account_status === 'ACTIVE')) throw new Error('Settings actor must be an existing protected core administrator');
    if (!await b.fact('AppSetting', row, sourceId, setting)) return;
    if (row.key === 'number.cooldownDays') {
      const cooldown = row.value;
      if (cooldown !== null && (typeof cooldown !== 'number' || !Number.isInteger(cooldown) || cooldown < 0 || cooldown > 365)) throw new Error('Actual cooldown setting is invalid');
      b.write('AppSetting', row, 'once_settings', { storefront_id: 'once', cooldown_days: cooldown, version: 1, updated_at: row.updatedAt, updated_by: setting.actorId }, { storefront_id: 'once' }, true);
    } else if (row.key === 'points.rechargeRules') {
      const original = record(row.value), rules = setting.rechargeRules;
      if (!rules) throw new Error('Actual source rules need explicit currency/precision/rate conversion');
      for (const field of ['enabled', 'minMinor', 'maxMinor', 'dailyMinor', 'presetsMinor']) if (!await b.jsonEqual(original[field], rules[field])) throw new Error(`Rules conversion changes original ${field}`);
      if (typeof rules.currency !== 'string' || !/^[A-Z]{3}$/.test(rules.currency) || !Number.isInteger(rules.fractionDigits) || Number(rules.fractionDigits) < 0 || Number(rules.fractionDigits) > 6 || rules.exchangeAmountMinor !== 1 || rules.exchangePoints !== 1) throw new Error('Legacy rules require reviewed currency/precision and original 1:1 exchange, without invented prices');
      const { minMinor, maxMinor, ...configured } = rules;
      const converted = rechargeRulesSchema.parse({ ...configured, minimumMinor: minMinor, maximumMinor: maxMinor });
      b.write('AppSetting', row, 'recharge_settings', { storefront_id: 'once', rules: converted, version: 1, updated_by: setting.actorId, updated_at: row.updatedAt }, { storefront_id: 'once' }, true);
    }
  });
}
