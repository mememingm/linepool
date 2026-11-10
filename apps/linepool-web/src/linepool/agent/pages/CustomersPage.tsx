import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { Customer } from '@linepool/contracts';
import { Plus } from 'lucide-react';
import { queryClient, workspaceApi as api } from '../../api/query-client';
import { agentQueryKey } from '../access';
import { ActionButton, Badge, DateText, Facts, Modal, State, Table } from '../../admin/primitives';
import { Identifier } from '../../admin/Presentation';
import { agentError, AgentPager } from '../subagent-shared';
import { ErrorText, Filter, FormFooter, useAgentAction, useCustomers } from './shared';
import type { AgentPageProps } from '../pages';

export default function CustomersPage({ access }: AgentPageProps) {
  const agentId = access.context.agent.id;
  const result = useCustomers(agentId);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [edit, setEdit] = useState<Customer | 'new' | null>(null);
  const [detail, setDetail] = useState<Customer | null>(null);
  const needle = search.trim().toLowerCase();
  const rows = (result.data ?? []).filter(c => (!status || c.status === status) && [c.name, c.id, c.userId].some(value => value.toLowerCase().includes(needle)));
  const pages = Math.ceil(rows.length / pageSize);
  const current = Math.min(page, pages || 1);
  return <>
    <div className="lp-admin-toolbar lp-agent-inventory-toolbar">
      <Filter title="搜索客户"><input value={search} placeholder="名称、客户 ID 或用户 ID" maxLength={120} onChange={e => { setSearch(e.target.value); setPage(1); }} /></Filter>
      <Filter title="客户状态"><select value={status} onChange={e => { setStatus(e.target.value); setPage(1); }}><option value="">全部状态</option><option value="ACTIVE">正常</option><option value="SUSPENDED">已暂停</option><option value="TERMINATED">已终止</option></select></Filter>
      <ActionButton variant="accent" onClick={() => setEdit('new')}><Plus size={16} />绑定客户</ActionButton>
    </div>
    <p className="lp-admin-context">管理自己的直属客户。暂停客户会停止新的代理业务，已有余额、历史记录和普通用户账号继续保留。</p>
    <State loading={result.isFetching} error={result.error ? agentError(result.error) : ''} retry={() => void result.refetch()} data={result.data} empty={!rows.length} columns={5} />
    {rows.length > 0 && <Table columns={['客户名称', '客户 ID', '状态', '创建时间', '操作']} label="客户管理">{rows.slice((current - 1) * pageSize, current * pageSize).map(customer => <tr key={customer.id}>
      <td><strong>{customer.name}</strong></td><td><Identifier value={customer.id} /></td><td><Badge value={customer.status} /></td><td><DateText value={customer.createdAt} /></td>
      <td><div className="lp-agent-row-actions"><ActionButton size="sm" onClick={() => setDetail(customer)}>详情</ActionButton><ActionButton size="sm" disabled={customer.status === 'TERMINATED'} onClick={() => setEdit(customer)}>编辑</ActionButton></div></td>
    </tr>)}</Table>}
    {result.data && <AgentPager page={current} pageSize={pageSize} totalItems={rows.length} totalPages={pages} busy={result.isFetching} onChange={(p, size) => { setPage(p); setPageSize(size); }} />}
    {edit && <CustomerForm key={typeof edit === 'string' ? edit : edit.id} customer={edit === 'new' ? null : edit} agentId={agentId} onClose={() => setEdit(null)} />}
    {detail && <CustomerDetail key={detail.id} customer={detail} agentId={agentId} onClose={() => setDetail(null)} />}
  </>;
}

function CustomerDetail({ customer, agentId, onClose }: { customer: Customer; agentId: string; onClose: () => void }) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(5);
  const holdings = useQuery({ queryKey: agentQueryKey(agentId, 'customer-holdings', customer.id, page, pageSize),
    queryFn: ({ signal }) => api.agentCustomerHoldings(customer.id, { page, pageSize }, { signal }) }, queryClient);
  return <Modal title="客户详情" onClose={onClose} variant="drawer"><div className="lp-admin-dialog-body"><Facts rows={[
    ['客户名称', customer.name], ['客户 ID', <Identifier value={customer.id} />], ['绑定用户 ID', <Identifier value={customer.userId} />], ['状态', <Badge value={customer.status} />], ['创建时间', <DateText value={customer.createdAt} />],
  ]} /><h3>客户号码与有效期</h3>
    <State loading={holdings.isFetching} error={holdings.error ? agentError(holdings.error) : ''} retry={() => void holdings.refetch()} data={holdings.data} />
    {holdings.data && (holdings.data.data.length ? <ul className="lp-agent-customer-numbers">{holdings.data.data.map(holding => <li key={holding.id}>
      <div><strong>{holding.phoneNumber}</strong><Badge value={holding.status === 'ACTIVE' && holding.expiresAt && new Date(holding.expiresAt).getTime() <= Date.now() ? 'EXPIRED' : holding.status} /></div>
      <span>{holding.service ?? '—'} · <DateText value={holding.startsAt} /> ～ {holding.expiresAt ? <DateText value={holding.expiresAt} /> : '长期'}</span>
    </li>)}</ul> : <p className="lp-admin-context">该客户还没有分配号码。</p>)}
    {holdings.data && <AgentPager page={page} pageSize={pageSize} totalItems={holdings.data.pagination.totalItems} totalPages={holdings.data.pagination.totalPages} busy={holdings.isFetching} onChange={(p, size) => { setPage(p); setPageSize(size); }} />}
    <a className="lp-agent-settings-link" href={`/agent/finance?customer=${customer.id}`}>查看该客户的余额与流水 →</a>
  </div></Modal>;
}

function CustomerForm({ customer, agentId, onClose }: { customer: Customer | null; agentId: string; onClose: () => void }) {
  const [userId, setUserId] = useState('');
  const [name, setName] = useState(customer?.name ?? '');
  const [status, setStatus] = useState<'ACTIVE' | 'SUSPENDED'>(customer?.status === 'SUSPENDED' ? 'SUSPENDED' : 'ACTIVE');
  const [reason, setReason] = useState('');
  const action = useAgentAction(agentId);
  return <Modal title={customer ? '编辑客户' : '绑定已有客户'} onClose={onClose} busy={action.busy}><form className="lp-agent-form" onSubmit={e => {
    e.preventDefault(); void action.run(() => customer ? api.agentUpdateCustomer(customer.id, { name: name.trim(), status, reason: reason.trim() }) : api.agentCreateCustomer({ userId: userId.trim(), agentId, name: name.trim() }), onClose, customer ? '客户已更新' : '客户已绑定');
  }}><div className="lp-admin-dialog-body"><fieldset disabled={action.busy}>
    {!customer && <><p className="lp-admin-context">绑定已注册且未加入代理体系的普通账号。请让客户登录普通工作台，在「账户设置 → 账户资料 → 用户 ID」复制完整 ID 后发给你。</p><label>用户 ID<input required autoFocus value={userId} onChange={e => setUserId(e.target.value)} placeholder="用户 UUID" /></label></>}
    <label>客户名称<input required maxLength={120} value={name} onChange={e => setName(e.target.value)} /></label>
    {customer && <><label>客户状态<select value={status} onChange={e => setStatus(e.target.value as typeof status)}><option value="ACTIVE">正常</option><option value="SUSPENDED">暂停代理业务</option></select></label><label>修改原因<textarea required minLength={3} maxLength={200} value={reason} onChange={e => setReason(e.target.value)} /></label></>}
  </fieldset><ErrorText error={action.error} /></div><FormFooter busy={action.busy} onClose={onClose} disabled={!name.trim() || (!customer && !userId.trim())} label={customer ? '保存修改' : '确认绑定'} /></form></Modal>;
}
