import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { AdminShopProduct } from '@linepool/contracts/admin';
import { queryClient, workspaceApi as api } from '../api/query-client';
import { Input } from '../ui/input';
import { useDisplayPreferences } from '../preferences/useDisplayPreferences';
import { apiMessage } from '../workspace-reference/workspace-data';
import { ActionButton, Modal, State, Table, regionName } from './primitives';

/** Shops set their own prices. Administrators only review them and can hold a product off sale, with a reason. */
export default function ShopProducts({ revision }: { revision: number }) {
  const p = useDisplayPreferences();
  const products = useQuery({ queryKey: ['admin-shop-products', revision], queryFn: async ({ signal }) => (await api.adminShopProducts({ signal })).data, staleTime: 0 }, queryClient);
  const [target, setTarget] = useState<AdminShopProduct | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function confirm() {
    if (!target || busy) return;
    setBusy(true); setError('');
    try { await api.adminHoldShopProduct(target.id, { hold: !target.adminHold, reason }); setTarget(null); setReason(''); await products.refetch(); }
    catch (cause) { setError(apiMessage(cause)); }
    finally { setBusy(false); }
  }
  return <>
    <div className="lp-admin-section-heading"><div><h2>{p.t('店铺商品')}</h2><p className="lp-admin-context">{p.t('前台出售的是官方店铺的商品，价格由店铺自己设置。管理员不能改价，只能在需要时下架。')}</p></div></div>
    <State loading={products.isPending} error={products.error ? apiMessage(products.error) : ''} data={products.data} retry={() => void products.refetch()} empty={products.data?.length === 0} columns={7} />
    {Boolean(products.data?.length) && <Table label={p.t('店铺商品')} columns={[p.t('店铺'), p.t('商品'), p.t('国家 / 平台'), p.t('时长'), p.t('价格（积分）'), p.t('可售号码'), p.t('状态'), '']}>{products.data!.map(product => <tr key={product.id}>
      <td><strong>{product.agentName}</strong><small>{p.t(product.shopKind === 'OFFICIAL' ? '官方店铺' : '代理店铺')}</small></td>
      <td>{product.name}</td><td>{regionName(product.region)}<small>{product.platformName}</small></td>
      <td className="lp-admin-numeric">{product.durationDays} {p.t('天')}</td><td className="lp-admin-numeric">{p.n(product.unitPoints)}</td><td className="lp-admin-numeric">{p.n(product.availableCount)}</td>
      <td>{p.t(product.adminHold ? '平台已下架' : product.isActive ? '在售' : '店铺未上架')}{product.adminHoldReason && <small>{product.adminHoldReason}</small>}</td>
      <td><ActionButton size="sm" onClick={() => { setError(''); setReason(''); setTarget(product); }}>{p.t(product.adminHold ? '恢复' : '下架')}</ActionButton></td>
    </tr>)}</Table>}
    {target && <Modal title={p.t(target.adminHold ? '恢复店铺商品' : '下架店铺商品')} variant="confirmation" busy={busy} onClose={() => setTarget(null)}><form onSubmit={event => { event.preventDefault(); void confirm(); }}><div className="lp-admin-dialog-body">
      <p>{target.agentName} · {target.name}</p>
      <label>{p.t('操作原因')}<Input required minLength={3} maxLength={500} value={reason} onChange={event => setReason(event.target.value)} /></label>
      <p className="lp-admin-context">{p.t(target.adminHold ? '恢复后是否在售由店铺自己的上架状态决定。' : '下架后买家无法购买该商品，已售服务不受影响。原因会显示给店铺。')}</p>
      {error && <p className="lp-admin-error" role="alert">{error}</p>}
    </div><footer><ActionButton disabled={busy} onClick={() => setTarget(null)}>{p.t('取消')}</ActionButton><ActionButton type="submit" variant="accent" busy={busy} disabled={reason.trim().length < 3}>{p.t(target.adminHold ? '确认恢复' : '确认下架')}</ActionButton></footer></form></Modal>}
  </>;
}
