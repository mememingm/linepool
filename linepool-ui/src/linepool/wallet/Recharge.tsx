import { createContext, useCallback, useContext, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { ArrowRight, Check, CreditCard, LoaderCircle, LockKeyhole, ReceiptText, WalletCards, X } from 'lucide-react';
import { calculateRechargePoints, formatRechargeAmount, parseRechargeAmount, type Account, type RechargeOverview, type RechargeStatus } from '../api/contracts';
import { apiMessage } from '../workspace-reference/workspace-data';
import { createLinepoolApi } from '../api/client';
import { useDisplayPreferences } from '../preferences/useDisplayPreferences';
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../ui/dialog';
import { Button } from '../ui/button';
import { ToggleGroup, ToggleGroupItem } from '../ui/toggle-group';
import { InputGroup, InputGroupAddon, InputGroupInput } from '../ui/input-group';
import { RadioGroup, RadioGroupItem } from '../ui/radio-group';
import { Card, CardContent } from '../ui/card';
import { Field, FieldDescription, FieldError, FieldLabel, FieldLegend, FieldSet } from '../ui/field';
import SelectField from '../SelectField';
import RecordPagination from '../workspace-reference/RecordPagination';
import type { RecordPageSize } from '../workspace-reference/useRecordPagination';
import './Recharge.css';

type Panel = 'recharge' | 'transactions';
type RechargeContextValue = { open: (panel: Panel, fromCheckout?: boolean) => void; pointsBalance: number };
const RechargeContext = createContext<RechargeContextValue | null>(null);
const api = createLinepoolApi();
const statusLabels = { PENDING: '待支付', SUCCEEDED: '已到账', FAILED: '支付失败', EXPIRED: '已超时', CANCELLED: '已取消' } as const;

function RechargeRecords() {
  const p = useDisplayPreferences();
  const id = useId();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<RecordPageSize>(5);
  const [status, setStatus] = useState<RechargeStatus | ''>('');
  const [reload, setReload] = useState(0);
  const key = `${page}:${pageSize}:${status}:${reload}`;
  const [state, setState] = useState<{ key: string; data: Awaited<ReturnType<typeof api.rechargeRecords>> | null; failed: boolean; loading: boolean }>({ key, data: null, failed: false, loading: true });
  useEffect(() => {
    const controller = new AbortController();
    setState({ key, data: null, failed: false, loading: true });
    void api.rechargeRecords({ page, pageSize, status }, { signal: controller.signal }).then(data => {
      if (!controller.signal.aborted) setState({ key, data, failed: false, loading: false });
    }).catch(() => { if (!controller.signal.aborted) setState({ key, data: null, failed: true, loading: false }); });
    return () => controller.abort();
  }, [key]);
  const { data, failed, loading } = state.key === key ? state : { data: null, failed: false, loading: true };
  const date = (value: string | null) => value ? p.date(value, { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—';
  return <div className="lp-recharge-transactions">
    <div className="lp-recharge-record-toolbar"><SelectField aria-label={p.t('充值状态')} value={status} disabled={loading} onValueChange={value => { setStatus(value as RechargeStatus | ''); setPage(1); }} options={[{ value: '', label: p.t('全部状态') }, ...Object.entries(statusLabels).map(([value, label]) => ({ value, label: p.t(label) }))]} /><Button type="button" variant="outline" disabled={loading} onClick={() => setReload(value => value + 1)}>{p.t('刷新记录')}</Button></div>
    {loading ? <div className="lp-recharge-state" role="status"><LoaderCircle className="lp-recharge-spinner" size={20} aria-hidden="true" />{p.t('正在加载充值记录…')}</div>
      : failed ? <div className="lp-recharge-state" role="alert"><p>{p.t('读取充值记录失败，请重试')}</p><Button variant="outline" onClick={() => setReload(value => value + 1)}>{p.t('重试')}</Button></div>
        : data && <><div className="lp-recharge-table-scroll" tabIndex={0} role="region" aria-label={p.t('充值记录')}><table id={id}><thead><tr>{['充值单号', '充值金额', '积分', '支付方式', '充值状态', '创建时间', '到账时间'].map(label => <th scope="col" key={label}>{p.t(label)}</th>)}</tr></thead><tbody>
          {data.data.length ? data.data.map(record => <tr key={record.id} className="lp-recharge-record"><td className="lp-recharge-record-number">{record.orderNumber}</td><td>{formatRechargeAmount(record.amountMinor, record, p.locale)}</td><td>{p.n(record.points)}</td><td>{record.paymentMethod ?? '—'}</td><td><span className="lp-recharge-record-status" data-status={record.status}>{p.t(statusLabels[record.status])}</span></td><td>{date(record.createdAt)}</td><td>{date(record.creditedAt)}</td></tr>)
            : <tr><td colSpan={7}><ReceiptText size={28} strokeWidth={1.3} aria-hidden="true" /><p>{p.t(status ? '暂无符合条件的充值记录' : '暂无充值记录')}</p></td></tr>}
        </tbody></table></div><RecordPagination busy={loading} page={page} pageSize={pageSize} totalPages={data.pagination.totalPages} totalItems={data.pagination.totalItems} controls={id} onPageChange={setPage} onPageSizeChange={size => { setPageSize(size); setPage(1); }} /></>}
    <p className="lp-recharge-hint">{p.t('支付渠道尚未开通，暂不能付款。')}</p>
  </div>;
}

export function RechargeProvider({ account, onCredit, children }: { account: Account; onCredit?: () => Promise<unknown>; children: ReactNode }) {
  const p = useDisplayPreferences();
  const id = useId();
  const [panel, setPanel] = useState<Panel>('recharge');
  const [isOpen, setOpen] = useState(false);
  const [fromCheckout, setFromCheckout] = useState(false);
  const [overview, setOverview] = useState<RechargeOverview | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [reload, setReload] = useState(0);
  const [creditBusy, setCreditBusy] = useState(false);
  const [creditNotice, setCreditNotice] = useState('');
  const creditLock = useRef(false);
  async function claimCredit() {
    if (creditLock.current || !account.sandboxEnabled) return;
    creditLock.current = true; setCreditBusy(true); setCreditNotice('');
    try {
      const result = await api.sandboxCredit();
      setCreditNotice(result.data.status === 'GRANTED' ? '已领取 100 测试积分，可继续创建服务' : '本账户已领取过测试积分');
      await onCredit?.();
    } catch (error) { setCreditNotice(apiMessage(error, p.locale)); }
    finally { creditLock.current = false; setCreditBusy(false); }
  }
  const [preset, setPreset] = useState('');
  const [custom, setCustom] = useState('');
  const [touched, setTouched] = useState(false);
  const returnFocus = useRef<HTMLElement | null>(null);
  const open = useCallback((next: Panel, checkout = false) => {
    returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setPanel(next); setFromCheckout(checkout); setPreset(''); setCustom(''); setTouched(false); setOverview(null); setOpen(true);
  }, []);
  useEffect(() => {
    if (!isOpen || panel !== 'recharge') return;
    const controller = new AbortController();
    setLoading(true); setFailed(false); setOverview(null);
    void api.rechargeOverview({ signal: controller.signal }).then(response => {
      if (!controller.signal.aborted) { setOverview(response.data); setPreset(''); }
    }).catch(() => { if (!controller.signal.aborted) setFailed(true); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [isOpen, panel, account.id, reload]);
  const rules = overview?.rules ?? null;
  const result = parseRechargeAmount(custom, rules);
  const selectedMinor = preset && rules?.presetsMinor.includes(Number(preset)) ? Number(preset) : result.amountMinor;
  const conversion = selectedMinor === null ? null : calculateRechargePoints(selectedMinor, rules);
  const money = (minor: number) => rules ? formatRechargeAmount(minor, rules, p.locale) : '—';
  const range = rules ? p.t('充值范围：{min} – {max}', { min: money(rules.minimumMinor), max: money(rules.maximumMinor) }) : p.t('充值规则尚未配置，请稍后再试。');
  const amountError = !touched || preset || !result.error || result.error === 'empty' ? ''
    : result.error === 'configuration' ? p.t('币种与金额范围尚未配置')
      : result.error === 'precision' ? p.t('金额最多保留 {digits} 位小数', { digits: rules!.fractionDigits })
        : result.error === 'range' ? range : p.t('请输入有效的正数金额');
  const pointsError = conversion?.error === 'precision' ? p.t('当前金额不能兑换为整数积分，请调整金额。')
    : conversion?.error === 'range' ? p.t('兑换积分超出范围，请调整金额。') : '';

  return <RechargeContext.Provider value={{ open, pointsBalance: account.pointsBalance }}>
    {children}
    <Dialog open={isOpen} onOpenChange={setOpen}>
      <DialogContent className={`lp-recharge-dialog${panel === 'transactions' ? ' lp-recharge-dialog-records' : ''}`} data-theme={p.theme} lang={p.locale} showCloseButton={false} onCloseAutoFocus={event => {
        if (returnFocus.current?.isConnected) { event.preventDefault(); returnFocus.current.focus({ preventScroll: true }); }
      }}>
        <DialogClose asChild><Button variant="ghost" size="icon" className="lp-recharge-close" aria-label={p.t('关闭充值弹窗')}><X size={17} aria-hidden="true" /></Button></DialogClose>
        <DialogHeader className="lp-recharge-heading"><DialogTitle>{p.t(panel === 'recharge' ? '账户充值' : '充值记录')}</DialogTitle><DialogDescription>{p.t(panel === 'recharge' ? '选择充值金额，查看预计到账积分。' : '查看充值金额、积分与到账状态。')}</DialogDescription></DialogHeader>
        <div className="lp-recharge-panels" aria-label={p.t('充值与记录')}><Button type="button" variant="ghost" aria-pressed={panel === 'recharge'} onClick={() => setPanel('recharge')}><CreditCard size={15} aria-hidden="true" />{p.t('账户充值')}</Button><Button type="button" variant="ghost" aria-pressed={panel === 'transactions'} onClick={() => setPanel('transactions')}><ReceiptText size={15} aria-hidden="true" />{p.t('充值记录')}</Button></div>
        {account.sandboxEnabled && panel === 'recharge' && <div className="lp-recharge-sandbox"><p>{p.t('当前为独立测试环境，每个账户可领取一次 100 测试积分，无需付款。')}</p><Button type="button" variant="outline" disabled={creditBusy} onClick={() => void claimCredit()}>{p.t(creditBusy ? '正在领取…' : '领取 100 测试积分')}</Button>{creditNotice && <p role="status">{p.t(creditNotice)}</p>}</div>}
        {panel === 'transactions' ? <RechargeRecords key={account.id} /> : loading ? <div className="lp-recharge-state" role="status"><LoaderCircle className="lp-recharge-spinner" size={20} aria-hidden="true" />{p.t('正在读取账户信息…')}</div>
          : failed ? <div className="lp-recharge-state" role="alert"><p>{p.t('读取账户信息失败，请重试')}</p><Button variant="outline" onClick={() => setReload(value => value + 1)}>{p.t('重试')}</Button></div>
            : overview && <form className="lp-recharge-form" onSubmit={event => event.preventDefault()}>
              <div className="lp-recharge-body">
                <Card className="lp-recharge-balance" aria-label={p.t('可用积分余额')}><CardContent className="lp-recharge-balance-content"><div className="lp-recharge-points"><span className="lp-recharge-balance-label"><WalletCards size={16} aria-hidden="true" />{p.t('可用积分余额')}</span><strong>{p.n(overview.pointsBalance)} <small>{p.t('积分')}</small></strong></div><WalletCards className="lp-recharge-balance-icon" size={32} strokeWidth={1.2} aria-hidden="true" /></CardContent></Card>
                <FieldSet className="lp-recharge-fieldset"><FieldLegend variant="label">{p.t('快捷充值金额')}</FieldLegend>
                  {rules?.presetsMinor.length ? <ToggleGroup type="single" spacing={2} value={preset} onValueChange={value => { setPreset(value); if (value) { setCustom(''); setTouched(false); } }} className="lp-recharge-amounts" aria-label={p.t('快捷充值金额')}>
                    {rules.presetsMinor.map(amount => { const points = calculateRechargePoints(amount, rules).points; return <ToggleGroupItem className="lp-recharge-amount" key={amount} value={String(amount)}><span>{money(amount)}</span>{points !== null && <small>{p.t('{count} 积分', { count: p.n(points) })}</small>}{preset === String(amount) && <Check className="lp-recharge-amount-check" size={13} aria-hidden="true" />}</ToggleGroupItem>; })}
                  </ToggleGroup> : <FieldDescription className="lp-recharge-hint lp-recharge-pending">{p.t(rules ? '请输入自定义充值金额' : '充值规则尚未配置，请稍后再试。')}</FieldDescription>}
                  {rules && <FieldDescription className="lp-recharge-hint lp-recharge-rate">{rules.exchangeAmountMinor && rules.exchangePoints ? p.t('兑换比例：{amount} = {points} 积分', { amount: money(rules.exchangeAmountMinor), points: p.n(rules.exchangePoints) }) : p.t('积分兑换比例尚未配置')}</FieldDescription>}
                </FieldSet>
                <Field className="lp-recharge-custom" data-invalid={!!amountError || !!pointsError || undefined}><FieldLabel htmlFor={`${id}-amount`}>{p.t('自定义充值金额')}</FieldLabel>
                  <InputGroup className="lp-recharge-input" data-invalid={!!amountError || !!pointsError || undefined}>
                    {rules && <InputGroupAddon>{new Intl.NumberFormat(p.locale, { style: 'currency', currency: rules.currency }).formatToParts(0).find(part => part.type === 'currency')?.value ?? rules.currency}</InputGroupAddon>}
                    <InputGroupInput id={`${id}-amount`} type="text" inputMode="decimal" disabled={!rules} autoComplete="off" maxLength={32} placeholder={p.t('输入金额')} value={custom} aria-invalid={!!amountError || !!pointsError} aria-describedby={`${id}-range${amountError || pointsError ? ` ${id}-error` : ''}`} onChange={event => { setCustom(event.target.value); setPreset(''); setTouched(true); }} onBlur={() => setTouched(true)} />
                  </InputGroup><FieldDescription id={`${id}-range`} className="lp-recharge-hint">{range}</FieldDescription>{(amountError || pointsError) && <FieldError id={`${id}-error`} className="lp-recharge-error">{amountError || pointsError}</FieldError>}
                </Field>
                <FieldSet className="lp-recharge-fieldset"><FieldLegend variant="label">{p.t('支付方式')}</FieldLegend><RadioGroup value="" disabled aria-label={p.t('支付方式')} className="lp-recharge-methods"><Field orientation="horizontal" className="lp-recharge-method" data-disabled="true"><RadioGroupItem id={`${id}-method`} value="unavailable" disabled /><FieldLabel htmlFor={`${id}-method`}><CreditCard size={18} aria-hidden="true" /><span>{p.t('暂无可用支付方式')}</span></FieldLabel></Field></RadioGroup></FieldSet>
              </div>
              <div className="lp-recharge-footer"><div className="lp-recharge-summary"><span>{p.t('充值金额')}</span><strong>{selectedMinor !== null ? money(selectedMinor) : '—'}</strong></div><div className="lp-recharge-summary lp-recharge-points-preview" aria-live="polite" aria-atomic="true"><span>{p.t('预计到账')}</span><strong>{conversion?.points != null ? p.t('{count} 积分', { count: p.n(conversion.points) }) : '—'}</strong></div>
                <Button type="submit" className="lp-recharge-confirm" disabled aria-label={p.t('确认充值')} aria-describedby={`${id}-unavailable`}><LockKeyhole size={15} aria-hidden="true" />{p.t('支付暂未开通')}</Button><p id={`${id}-unavailable`} className="lp-recharge-hint lp-recharge-status" role="status">{p.t('支付渠道尚未开通，暂不能付款。')}</p>
                {fromCheckout && <p className="lp-recharge-hint lp-recharge-checkout-note">{p.t('关闭后可继续原订单，已选服务将保留。')}</p>}
              </div>
            </form>}
      </DialogContent>
    </Dialog>
  </RechargeContext.Provider>;
}
export function WalletHeader() {
  const wallet = useContext(RechargeContext);
  const p = useDisplayPreferences();
  if (!wallet) return null;
  return <div className="lp-wallet-header"><div className="lp-wallet-available"><WalletCards size={17} aria-hidden="true" /><span className="lp-wallet-balance-label">{p.t('可用积分余额')}</span><strong>{p.n(wallet.pointsBalance)}</strong><span>{p.t('积分')}</span></div></div>;
}
export function SidebarRechargeButton({ onOpen }: { onOpen: () => void }) {
  const wallet = useContext(RechargeContext);
  const p = useDisplayPreferences();
  return wallet ? <button type="button" className="lp-shell-tool-recharge" aria-label={p.t('积分充值')} title={p.t('积分充值')} onClick={() => { onOpen(); wallet.open('recharge'); }}><WalletCards size={17} strokeWidth={1.5} aria-hidden="true" /><span>{p.t('积分充值')}</span><ArrowRight size={15} strokeWidth={1.5} aria-hidden="true" /></button> : null;
}
export function RechargeButton({ fromCheckout = false }: { fromCheckout?: boolean }) {
  const wallet = useContext(RechargeContext);
  const p = useDisplayPreferences();
  return wallet ? <Button variant="outline" size="sm" className="lp-wallet-entry" onClick={() => wallet.open('recharge', fromCheckout)}><WalletCards size={15} aria-hidden="true" />{p.t('充值')}</Button> : null;
}
export function TransactionsButton() {
  const wallet = useContext(RechargeContext);
  const p = useDisplayPreferences();
  return wallet ? <Button variant="ghost" size="sm" className="lp-wallet-entry" onClick={() => wallet.open('transactions')}><ReceiptText size={15} aria-hidden="true" />{p.t('充值记录')}</Button> : null;
}
