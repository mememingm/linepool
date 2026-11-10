import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import type { AdminPlatform } from '@linepool/contracts/admin';
import { queryClient, workspaceApi as api } from '../api/query-client';
import { Checkbox } from '../ui/checkbox';
import { Input } from '../ui/input';
import { useDisplayPreferences } from '../preferences/useDisplayPreferences';
import { apiMessage } from '../workspace-reference/workspace-data';
import { ActionButton, Badge, DateText, Modal, State, Table } from './primitives';

export const adminPlatformsKey = ['admin-platforms'] as const;
export function useAdminPlatforms(revision = 0) {
  return useQuery({ queryKey: [...adminPlatformsKey, revision], queryFn: async ({ signal }) => (await api.adminPlatforms({ signal })).data, staleTime: 0 }, queryClient);
}

function PlatformEditor({ platform, onClose, onSaved }: { platform: AdminPlatform | null; onClose: () => void; onSaved: () => void }) {
  const p = useDisplayPreferences();
  const [id, setId] = useState(platform?.id ?? '');
  const [name, setName] = useState(platform?.name ?? '');
  const [isActive, setActive] = useState(platform?.isActive ?? true);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function save() {
    if (busy) return;
    setBusy(true); setError('');
    try { await api.adminSavePlatform({ id: id.trim(), name, isActive, reason }, !platform); onSaved(); }
    catch (cause) { setError(apiMessage(cause)); }
    finally { setBusy(false); }
  }
  return <Modal title={p.t(platform ? '编辑平台' : '新增平台')} onClose={onClose} busy={busy}><form onSubmit={event => { event.preventDefault(); void save(); }}><div className="lp-admin-dialog-body"><fieldset className="lp-admin-form-grid" disabled={busy}>
    <label>{p.t('平台 ID')}<Input required readOnly={Boolean(platform)} pattern="[A-Za-z0-9][A-Za-z0-9._\-]{0,39}" maxLength={40} value={id} onChange={event => setId(event.target.value)} />
      <small>{p.t(platform ? '平台 ID 创建后不能修改。' : '例如 Telegram、Discord。字母、数字、点、下划线或短横线，创建后不能修改。')}</small></label>
    <label>{p.t('显示名称')}<Input required maxLength={80} value={name} onChange={event => setName(event.target.value)} /></label>
    <label className="lp-admin-checkbox lp-admin-span"><Checkbox checked={isActive} onCheckedChange={value => setActive(value === true)} />{p.t('启用（用户可以看到并购买该平台的商品）')}</label>
    <label className="lp-admin-span">{p.t('操作原因')}<Input required minLength={3} maxLength={500} value={reason} onChange={event => setReason(event.target.value)} /><small>{p.t('会写入操作记录。')}</small></label>
    {error && <p className="lp-admin-error lp-admin-span" role="alert">{error}</p>}
  </fieldset></div><footer><ActionButton onClick={onClose} disabled={busy}>{p.t('取消')}</ActionButton><ActionButton type="submit" variant="accent" busy={busy}>{p.t('保存平台')}</ActionButton></footer></form></Modal>;
}

/** Administrator-defined platforms. Each synced self-service number gets one stock slot per platform. */
export default function PlatformsPage({ revision }: { revision: number }) {
  const p = useDisplayPreferences();
  const platforms = useAdminPlatforms(revision);
  const [editor, setEditor] = useState<AdminPlatform | null | undefined>();
  const [notice, setNotice] = useState('');
  return <>
    <div className="lp-admin-section-heading"><p className="lp-admin-context">{p.t('平台由管理员定义。每个自营号码在每个启用的平台上各有一份库存；停用平台会停止新销售，已售服务不受影响。')}</p>
      <ActionButton variant="accent" onClick={() => { setNotice(''); setEditor(null); }}><Plus size={16} />{p.t('新增平台')}</ActionButton></div>
    {notice && <p className="lp-pc-notice lp-pc-inline" role="status">{notice}</p>}
    <State loading={platforms.isPending} error={platforms.error ? apiMessage(platforms.error) : ''} data={platforms.data} retry={() => void platforms.refetch()} empty={platforms.data?.length === 0} columns={6} />
    {Boolean(platforms.data?.length) && <Table label={p.t('平台管理')} columns={[p.t('平台'), p.t('状态'), p.t('在售商品'), p.t('可售库存'), p.t('验证码规则'), p.t('创建时间'), '']}>{platforms.data!.map(platform => <tr key={platform.id}>
      <td><strong>{platform.name}</strong><small>{platform.id}</small></td>
      <td><Badge value={platform.isActive ? 'ACTIVE' : 'DISABLED'} /></td>
      <td className="lp-admin-numeric">{p.n(platform.activeProducts)}</td>
      <td className="lp-admin-numeric">{p.n(platform.availableSlots)}</td>
      <td>{p.t(platform.codeRuleEnabled ? '已启用' : '未配置')}</td>
      <td><DateText value={platform.createdAt} /></td>
      <td><ActionButton size="sm" onClick={() => { setNotice(''); setEditor(platform); }}>{p.t('编辑')}</ActionButton></td>
    </tr>)}</Table>}
    {editor !== undefined && <PlatformEditor key={editor?.id ?? 'new'} platform={editor} onClose={() => setEditor(undefined)} onSaved={() => { setEditor(undefined); setNotice(p.t('平台已保存，库存已按平台更新。')); void queryClient.invalidateQueries({ queryKey: adminPlatformsKey }); }} />}
  </>;
}
