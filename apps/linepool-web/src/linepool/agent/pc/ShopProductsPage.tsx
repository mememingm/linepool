import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Plus, Store } from 'lucide-react';
import type { AgentShop, ShopProduct, ShopProductInput } from '@linepool/contracts/admin';
import { queryClient, workspaceApi as api } from '../../api/query-client';
import { Card } from '../../ui/card';
import { Checkbox } from '../../ui/checkbox';
import { Input } from '../../ui/input';
import SelectField from '../../SelectField';
import { ActionButton, Modal, State, Table, regionName } from '../../admin/primitives';
import { useDisplayPreferences } from '../../preferences/useDisplayPreferences';
import { pcError } from '../pc-components';
import { PcEmpty, PcFeedback, type PcPageProps } from './shared';

function ProductEditor({ shop, product, onClose, onSaved }: { shop: AgentShop; product: ShopProduct | null; onClose: () => void; onSaved: () => void }) {
  const p = useDisplayPreferences();
  const [region, setRegion] = useState<ShopProductInput['region']>(product?.region ?? shop.regions[0] ?? 'us');
  const [platformId, setPlatform] = useState(product?.platformId ?? shop.platforms[0]?.id ?? '');
  const [durationDays, setDays] = useState<7 | 30>(product?.durationDays === 30 ? 30 : 7);
  const [name, setName] = useState(product?.name ?? '');
  const [unitPoints, setPoints] = useState(String(product?.unitPoints ?? ''));
  const [isActive, setActive] = useState(product?.isActive ?? true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function save() {
    if (busy) return;
    setBusy(true); setError('');
    try {
      await api.pcSaveShopProduct({ region, platformId, durationDays, name: name.trim() || `${durationDays} ${p.t('天托管接码')}`, unitPoints: Number(unitPoints), isActive }, product?.id);
      onSaved();
    } catch (cause) { setError(pcError(cause)); }
    finally { setBusy(false); }
  }
  return <Modal title={p.t(product ? '编辑店铺商品' : '新增店铺商品')} onClose={onClose} busy={busy}><form onSubmit={event => { event.preventDefault(); void save(); }}><div className="lp-admin-dialog-body"><fieldset className="lp-admin-form-grid lp-pc-form" disabled={busy}>
    <label>{p.t('国家')}<SelectField aria-label={p.t('国家')} value={region} disabled={Boolean(product)} onValueChange={value => setRegion(value as ShopProductInput['region'])} options={shop.regions.map(id => ({ value: id, label: regionName(id) }))} /></label>
    <label>{p.t('平台')}<SelectField aria-label={p.t('平台')} value={platformId} disabled={Boolean(product)} onValueChange={setPlatform} options={shop.platforms.map(platform => ({ value: platform.id, label: platform.name }))} /></label>
    <label>{p.t('服务时长')}<SelectField aria-label={p.t('服务时长')} value={String(durationDays)} disabled={Boolean(product)} onValueChange={value => setDays(value === '30' ? 30 : 7)} options={[{ value: '7', label: p.t('7 天') }, { value: '30', label: p.t('30 天') }]} /></label>
    <label>{p.t('价格（积分）')}<Input type="number" required min={1} max={1000000} step={1} value={unitPoints} onChange={event => setPoints(event.target.value)} /></label>
    <label className="lp-admin-span">{p.t('商品名称')}<Input maxLength={120} placeholder={`${durationDays} ${p.t('天托管接码')}`} value={name} onChange={event => setName(event.target.value)} /></label>
    {product && <p className="lp-admin-context lp-admin-span">{p.t('国家、平台和时长不能修改；需要其他组合请新增商品。')}</p>}
    <label className="lp-admin-checkbox lp-admin-span"><Checkbox checked={isActive} onCheckedChange={value => setActive(value === true)} />{p.t('上架（买家可以在前台看到并购买）')}</label>
    {error && <p className="lp-admin-error lp-admin-span" role="alert">{error}</p>}
  </fieldset></div><footer><ActionButton onClick={onClose} disabled={busy}>{p.t('取消')}</ActionButton><ActionButton type="submit" variant="accent" busy={busy} disabled={!platformId}>{p.t('保存商品')}</ActionButton></footer></form></Modal>;
}

/** "Each shop sells its own": the agent who runs a shop lists its products and sets its own prices in site points. */
export default function ShopProductsPage({ user }: PcPageProps) {
  const p = useDisplayPreferences();
  const shop = useQuery({ queryKey: ['pc-shop', user.id], queryFn: async ({ signal }) => (await api.pcShop({ signal })).data, staleTime: 0 }, queryClient);
  const [editor, setEditor] = useState<ShopProduct | null | undefined>();
  const [notice, setNotice] = useState('');
  if (!shop.data) return <State loading={shop.isPending} error={shop.error ? pcError(shop.error) : ''} retry={() => void shop.refetch()} />;
  if (!shop.data.shop) return <Card className="lp-admin-section lp-agent-page-card"><PcEmpty icon={Store} title="尚未开店">{p.t('你的账号还没有店铺，暂时不能在前台出售号码。开店由平台管理员操作；号码和短信仍可在工作台查看。')}</PcEmpty></Card>;
  const products = shop.data.products;
  const listed = products.filter(product => product.isActive && !product.adminHold);
  return <>
    <PcFeedback error="" notice={notice} />
    <div className="lp-agent-account-summary">
      <div><span>{p.t('店铺类型')}</span><strong>{p.t(shop.data.shop.kind === 'OFFICIAL' ? '官方店铺' : '代理店铺')}</strong></div>
      <div><span>{p.t('在售商品')}</span><strong>{p.n(listed.length)}</strong></div>
      <div><span>{p.t('未上架 / 被下架')}</span><strong>{p.n(products.length - listed.length)}</strong></div>
      <ActionButton variant="accent" disabled={!shop.data.platforms.length} onClick={() => { setNotice(''); setEditor(null); }}><Plus size={16} />{p.t('新增商品')}</ActionButton>
    </div>
    <Card className="lp-admin-section lp-agent-page-card"><div className="lp-admin-section-heading"><div><h2>{p.t('我的店铺商品')}</h2><p className="lp-admin-context">{p.t('买家在前台用站点积分购买，系统从你的号码中自动分配。价格由你自己决定。')}</p></div></div>
      {products.length ? <Table label="店铺商品" columns={[p.t('商品'), p.t('国家 / 平台'), p.t('时长'), p.t('价格（积分）'), p.t('可售号码'), p.t('状态'), '']}>{products.map(product => <tr key={product.id}>
        <td><strong>{product.name}</strong></td><td>{regionName(product.region)}<small>{product.platformName}</small></td>
        <td className="lp-admin-numeric">{product.durationDays} {p.t('天')}</td><td className="lp-admin-numeric">{p.n(product.unitPoints)}</td><td className="lp-admin-numeric">{p.n(product.availableCount)}</td>
        <td><span className="lp-admin-status lp-pc-status" data-tone={product.adminHold ? 'warning' : product.isActive ? 'success' : 'info'}>{p.t(product.adminHold ? '平台已下架' : product.isActive ? '在售' : '未上架')}</span>{product.adminHoldReason && <small>{product.adminHoldReason}</small>}</td>
        <td><ActionButton size="sm" onClick={() => { setNotice(''); setEditor(product); }}>{p.t('编辑')}</ActionButton></td>
      </tr>)}</Table> : <PcEmpty icon={Store} title="还没有店铺商品" action={<ActionButton variant="accent" onClick={() => setEditor(null)}><Plus size={16} />{p.t('新增商品')}</ActionButton>}>{p.t('新增第一个商品：选择国家、平台和时长，设置积分价格。')}</PcEmpty>}
    </Card>
    {editor !== undefined && <ProductEditor key={editor?.id ?? 'new'} shop={shop.data} product={editor} onClose={() => setEditor(undefined)} onSaved={() => { setEditor(undefined); setNotice(p.t('商品已保存')); void shop.refetch(); }} />}
  </>;
}
