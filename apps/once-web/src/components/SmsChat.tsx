import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowLeft, MessageSquare, Search, LoaderCircle, SquarePen } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { useApp } from '../app/AppProvider';
import { useWorkspace } from '../app/WorkspaceProvider';
import { apiPath, completeOperation, operationKey, request } from '../lib/api';
import { errorMessage, formatDateTime, leaseModel, leasePath, localDemo, sourceKey, type Lease, type OutboundMessage } from '../lib/models';
import { e164, formatPeer, normalizeRecipient, peerLabel, smsFailure, smsLabels, smsPeer, type ChatMessage, type ChatPage, type Conversation } from '../lib/sms';
import { EmptyNumbers, Heading, LeaseSwitcher, RENT_PATH } from './ui';
import { SmsComposer } from './SmsComposer';

function EmptyChat({title, text}: {title: string; text: string}) {
  return <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center"><MessageSquare className="size-9 text-muted-foreground/50" /><h2 className="text-base font-semibold">{title}</h2><p className="max-w-sm text-sm text-muted-foreground">{text}</p></div>;
}
function ChatError({error, retry}: {error: unknown; retry: () => void}) {
  return <div role="alert" className="p-4 text-sm text-destructive"><p>{errorMessage(error)}</p><Button variant="outline" size="sm" onClick={retry}>重新加载</Button></div>;
}
const dateLabel = (time: string) => new Date(time).toLocaleDateString('zh-CN', {month: 'long', day: 'numeric', weekday: 'short'});

export function SmsChat() {
  const {data, switching} = useWorkspace();
  if (!data?.lease) return <main className="content"><Heading title="短信" action /><EmptyNumbers /></main>;
  if (switching) return <div className="flex h-full items-center justify-center gap-2"><LoaderCircle className="size-4 animate-spin" />正在切换号码…</div>;
  return <ChatWorkspace key={data.lease.id} lease={data.lease} />;
}
function ChatWorkspace({lease}: {lease: Lease}) {
  const {account} = useApp(), client = useQueryClient();
  const [params, setParams] = useSearchParams();
  const [search, setSearch] = useState(''), [recipient, setRecipient] = useState('');
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [connected, setConnected] = useState(false);
  const preview = localDemo(), compose = params.has('compose'), peer = params.get('peer') || '';
  const scope = `${sourceKey()}:${account!.id}`, key = ['sms-chat', scope, lease.id];
  const conversations = useQuery({queryKey: [...key, 'conversations'],
    queryFn: ({signal}) => request<Conversation[]>(`/leases/${lease.id}/chat/conversations`, {signal})});
  useEffect(() => {
    if (preview) {
      const changed = () => {void client.invalidateQueries({queryKey: ['sms-chat', scope, lease.id]});};
      window.addEventListener('once-demo-chat', changed);
      window.addEventListener('storage', changed);
      return () => {window.removeEventListener('once-demo-chat', changed); window.removeEventListener('storage', changed);};
    }
    const stream = new EventSource(apiPath(`/leases/${lease.id}/chat/events`), { withCredentials: true });
    stream.onopen = () => setConnected(true);
    stream.onerror = () => setConnected(false);
    stream.addEventListener('unavailable', () => { setConnected(false); stream.close(); });
    stream.addEventListener('changed', () => {void client.invalidateQueries({queryKey: ['sms-chat', scope, lease.id]});});
    return () => stream.close();
  }, [scope, lease.id, client, preview]);
  const rows = (conversations.data || []).filter(row => (row.peer + row.body).toLowerCase().includes(search.toLowerCase().replace(/[\s()+-]/g, '')) || row.body.toLowerCase().includes(search.toLowerCase()));
  function openPeer(value: string) {
    setParams(previous => {const next = new URLSearchParams(previous); next.delete('compose'); next.set('peer', smsPeer(value)); return next;});
  }
  function newMessage() {
    setRecipient(''); setParams(previous => {const next = new URLSearchParams(previous); next.delete('peer'); next.set('compose', 'sms'); return next;});
  }
  function updateDraft(peerKey: string, value: string) { setDrafts(previous => ({...previous, [peerKey]: value})); }
  function back() {
    setParams(previous => {const next = new URLSearchParams(previous); next.delete('peer'); next.delete('compose'); return next;});
  }
  const active = peer || (!compose ? conversations.data?.[0]?.peer || '' : '');
  const recipientNumber = normalizeRecipient(recipient, lease.countryCode);
  const recipientValid = e164(recipientNumber);
  return <main className="sms-workspace flex h-full min-h-0 flex-col overflow-hidden" aria-label="短信">
    <div className="sms-heading flex shrink-0 items-center justify-between border-b px-4 py-3 md:px-7"><h1 className="font-semibold">短信</h1>
      <div className="flex items-center gap-2 text-xs text-muted-foreground"><span role="status" className="hidden sm:inline-flex sms-sync-state" data-state={preview ? 'preview' : connected ? 'live' : 'connecting'}>{preview ? '本地预览' : connected ? (lease.demo ? '演示数据 · 自动刷新' : '新短信自动刷新') : '正在连接…'}</span><Button asChild variant="ghost" size="sm"><Link to={leasePath('send', lease.id, {compose: 'mms'})}>彩信（即将推出）</Link></Button><Button asChild variant="outline" size="sm"><Link to={RENT_PATH}>租用新号码</Link></Button></div>
    </div>
    <div className="grid min-h-0 flex-1 grid-cols-1 overflow-hidden md:grid-cols-[320px_minmax(0,1fr)]">
      <aside className={`${peer || compose ? 'hidden md:flex' : 'flex'} min-h-0 min-w-0 flex-col border-r`} aria-label="会话列表">
        <div className="shrink-0 space-y-3 border-b p-4"><div className="flex items-center justify-between gap-2"><span className="text-xs text-muted-foreground">本机号码</span></div><div className="sms-number-switch"><LeaseSwitcher /></div>
          <Button className="w-full justify-center bg-blue-600 text-white hover:bg-blue-700" onClick={newMessage}><SquarePen className="size-4" />新建短信</Button>
          <Label className="asset-search inbox-search flex items-center rounded-lg border border-input" htmlFor="sms-search"><Search className="size-4 shrink-0 text-muted-foreground" /><Input id="sms-search" type="search" placeholder="搜索联系人或手机号" value={search} onChange={event => setSearch(event.target.value)} className="shadow-none" /></Label>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-2">
          {conversations.isPending ? <div className="space-y-4 p-3">{[1,2,3,4].map(i => <Skeleton className="h-14 w-full" key={i} />)}</div> : conversations.isError ? <ChatError error={conversations.error} retry={() => void conversations.refetch()} /> : !rows.length ? <EmptyChat title={search ? '没有匹配的会话' : '暂无短信会话'} text={search ? '试试其他号码或关键词。' : '新建短信，开始与手机号码通信。'} /> :
          <ul className="space-y-1">{rows.map(row => <li key={row.peer}><Button variant="ghost" className={`sms-conversation h-auto w-full justify-start gap-3 rounded-xl px-3 py-3 text-left ${active === row.peer && !compose ? 'bg-blue-500/10 text-blue-700 dark:text-blue-300' : ''}`} aria-current={active === row.peer && !compose ? 'true' : undefined} onClick={() => openPeer(row.peer)}>
            <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground"><MessageSquare className="size-4" /></span>
            <span className="min-w-0 flex-1"><span className="flex items-center justify-between gap-2"><strong className="truncate text-sm font-medium">{formatPeer(row.peer)}</strong><time className="shrink-0 text-xs font-normal text-muted-foreground">{new Date(row.time).toLocaleDateString('zh-CN', {month: 'numeric', day: 'numeric'})}</time></span>
              <span className="mt-1 flex items-center gap-2"><span className="min-w-0 flex-1 truncate text-xs font-normal text-muted-foreground">{row.direction === 'OUTBOUND' ? '你：' : ''}{row.body || '空短信'}</span>{row.unread > 0 && <Badge className="shrink-0 rounded-full bg-blue-600 text-white" aria-label={`${row.unread} 条未读`}>{row.unread}</Badge>}</span></span>
          </Button></li>)}</ul>}
        </div>
      </aside>
      <section className={`${peer || compose ? 'flex' : 'hidden md:flex'} min-h-0 min-w-0 flex-col overflow-hidden`} aria-label="聊天窗口">
        <header className="flex min-h-20 shrink-0 items-center gap-3 border-b px-4 md:px-6"><Button variant="ghost" size="icon" className="md:hidden" aria-label="返回会话列表" onClick={back}><ArrowLeft className="size-4" /></Button>
          {compose ? <form className="flex min-w-0 flex-1 items-center gap-3" onSubmit={event => {event.preventDefault(); if(recipientValid) openPeer(recipientNumber);}}><Label htmlFor="sms-recipient" className="shrink-0 text-sm">收件人</Label><Input autoFocus id="sms-recipient" type="tel" autoComplete="off" placeholder="+1 202 555 0199" value={recipient} onChange={event => setRecipient(event.target.value)} className="max-w-xs" aria-describedby="recipient-hint" aria-invalid={Boolean(recipient && !recipientValid)} /><Button size="sm" type="submit" disabled={!recipientValid}>开始</Button></form> : active ? <div className="min-w-0"><h2 className="truncate text-base font-semibold">{formatPeer(active)}</h2><p className="mt-1 text-xs text-muted-foreground">本机 {lease.number}</p></div> : <h2 className="text-sm text-muted-foreground">选择一个会话</h2>}
        </header>
        {compose && <p id="recipient-hint" className="border-b px-4 py-2 text-xs text-muted-foreground md:px-6" role="status">{recipientValid ? `将发送至 ${formatPeer(smsPeer(recipientNumber))}` : ['US', 'CA'].includes(lease.countryCode) ? '输入 10 位本地号码会自动补上 +1；其他国家号码请包含 + 和国家区号。' : '请输入以 + 和国家区号开头的完整手机号码。'}</p>}
        {compose && !recipientValid ? <EmptyChat title={recipient ? '号码尚不完整' : '新建短信'} text="请输入有效的收件人号码，再开始聊天。" /> : active || (compose && recipientValid) ? <Thread key={active || smsPeer(recipientNumber)} lease={lease} peer={active || smsPeer(recipientNumber)} scope={scope} preview={preview} selected={Boolean(peer)} draft={drafts[active || smsPeer(recipientNumber) || 'new'] || ''} onDraftChange={value => updateDraft(active || smsPeer(recipientNumber) || 'new', value)} /> : <EmptyChat title="你的短信，尽在一处" text="选择左侧会话，或新建短信开始聊天。" />}
      </section>
    </div>
  </main>;
}

function Thread({lease, peer, scope, preview, selected, draft, onDraftChange}: {lease: Lease; peer: string; scope: string; preview: boolean; selected: boolean; draft?: string; onDraftChange?: (value: string) => void}) {
  const {account} = useApp(), client = useQueryClient();
  const baseKey = ['sms-chat', scope, lease.id], queryKey = [...baseKey, 'thread', peer];
  const history = useInfiniteQuery({queryKey, initialPageParam: null as string | null,
    queryFn: ({pageParam, signal}) => request<ChatPage>(`/leases/${lease.id}/chat/messages?peer=${encodeURIComponent(peer)}&limit=50${pageParam ? '&cursor=' + encodeURIComponent(pageParam) : ''}`, {signal}),
    getNextPageParam: page => page.nextCursor});
  const messages = useMemo(() => Array.from(new Map(history.data?.pages.flatMap(page => page.items).map(row => [row.id, row]) || []).values()).sort((a,b) => a.time.localeCompare(b.time) || b.id.localeCompare(a.id)), [history.data]);
  const viewport = useRef<HTMLDivElement>(null), bottom = useRef(true), anchor = useRef<{height: number; top: number} | null>(null);
  const [newBelow, setNewBelow] = useState(false), [notice, setNotice] = useState(''), [visible, setVisible] = useState(document.visibilityState === 'visible');
  const marked = useRef(new Set<string>()), [, rerender] = useState(0), [reading, setReading] = useState(false);
  useEffect(() => {const changed = () => setVisible(document.visibilityState === 'visible'); document.addEventListener('visibilitychange', changed); return () => document.removeEventListener('visibilitychange', changed);}, []);
  const read = useMutation({mutationFn: (ids: string[]) => request(`/leases/${lease.id}/chat/read`, {method: 'POST', body: {ids}}),
    onSuccess: () => {void client.invalidateQueries({queryKey: baseKey});},
    onError: (_error, ids) => {ids.forEach(id => marked.current.delete(id)); setNotice('已读状态保存失败，可重试。');}});
  useLayoutEffect(() => {
    const area = viewport.current;
    if (!area) return;
    if (anchor.current) {if (!history.isFetchingNextPage) {area.scrollTop = anchor.current.top + area.scrollHeight - anchor.current.height; anchor.current = null;}}
    else if (bottom.current) {area.scrollTop = area.scrollHeight; setNewBelow(false);}
    else if (messages.length) setNewBelow(true);
  }, [messages, history.isFetchingNextPage]);
  useEffect(() => {
    if (!visible || (!selected && window.innerWidth < 768) || !bottom.current || read.isPending || read.isError) return;
    const ids = messages.filter(row => row.direction === 'INBOUND' && !row.readAt && !marked.current.has(row.id)).slice(-200).map(row => row.id);
    if (!ids.length) return;
    ids.forEach(id => marked.current.add(id)); read.mutate(ids);
  }, [messages, visible, reading, read.isPending, read.isError, preview, selected]);
  const send = useMutation({mutationFn: async ({body, retryId}: {body: string; retryId?: string}) => {
    const signature = `chat-sms:${lease.id}:${peer}:${retryId || ''}:${body}`;
    const result = await request<OutboundMessage>(`/leases/${lease.id}/outbound`, {method: 'POST', body: {to: peerLabel(peer), content: body}, headers: {'Idempotency-Key': operationKey(account!.id, signature)} });
    completeOperation(account!.id, signature);
    return result;
  }, onSuccess: async row => {
    bottom.current = true;
    setNotice(['FAILED','UNDELIVERABLE'].includes(row.status) ? smsFailure(row.errorCode) || '发送失败，请在消息旁重试。' : row.status === 'UNCERTAIN' ? '发送结果待确认，请查询本次状态。' : '');
    await client.invalidateQueries({queryKey: baseKey});
  }, onError: error => setNotice(errorMessage(error))});
  const checking = useMutation({mutationFn: (id: string) => request(`/leases/${lease.id}/outbound/${id}`), onSuccess: () => {void client.invalidateQueries({queryKey: baseKey});}, onError: error => setNotice(errorMessage(error))});
  const enabled = e164(peerLabel(peer)) && !['expired', 'unknown'].includes(leaseModel(lease).status) && Boolean(lease.smsSend?.enabled);
  const reason = !e164(peerLabel(peer)) ? '这是系统或服务号码发来的短信，不能直接回复。如需发短信，请点「新建短信」。' : lease.smsSend?.reason || '短信发送服务尚未开放。';
  async function submit(body: string) {
    setNotice('');
    try {await send.mutateAsync({body}); return true;} catch {return false;}
  }
  async function older() {
    const area = viewport.current;
    if (!area || history.isFetchingNextPage) return;
    anchor.current = {height: area.scrollHeight, top: area.scrollTop}; bottom.current = false;
    await history.fetchNextPage();
  }
  return <>
    <div ref={viewport} className="sms-message-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4 md:px-6" tabIndex={0} role="region" aria-label="短信记录" onScroll={() => {const area = viewport.current!; bottom.current = area.scrollHeight - area.scrollTop - area.clientHeight < 64; if(bottom.current) {setNewBelow(false); setReading(value => !value);}}}>
      {history.isPending ? <div className="space-y-5"><Skeleton className="h-12 w-2/3" /><Skeleton className="ml-auto h-14 w-1/2" /></div> : history.isError ? <ChatError error={history.error} retry={() => void history.refetch()} /> : <>
        {history.hasNextPage && <div className="mb-4 text-center"><Button variant="ghost" size="sm" disabled={history.isFetchingNextPage} onClick={() => void older()}>{history.isFetchingNextPage ? '正在加载…' : '加载更早的短信'}</Button></div>}
        {!messages.length && <p className="py-8 text-center text-sm text-muted-foreground">还没有聊天记录，发送第一条短信。</p>}
        <ol className="space-y-1.5">{messages.map((row, i) => {
          const previous = messages[i-1], outgoing = row.direction === 'OUTBOUND';
          const separated = !previous || +new Date(row.time) - +new Date(previous.time) > 300000;
          const failure = ['FAILED','UNDELIVERABLE'].includes(row.status);
          return <li key={row.id} data-message-id={row.id}>
            {separated && <div className="my-5 text-center text-xs text-muted-foreground"><time dateTime={row.time}>{dateLabel(row.time)} · {new Date(row.time).toLocaleTimeString('zh-CN', {hour: '2-digit', minute: '2-digit'})}</time></div>}
            <div className={`flex ${outgoing ? 'justify-end' : 'justify-start'}`}><div className="max-w-[85%] sm:max-w-[75%] lg:max-w-[65%]">
              <p className={`sms-bubble whitespace-pre-wrap break-words rounded-2xl px-4 py-2.5 text-sm leading-relaxed [overflow-wrap:anywhere] ${outgoing ? 'rounded-br-md bg-blue-600 text-white' : 'rounded-bl-md bg-muted text-foreground'}`}>{row.body || '(空短信)'}</p>
              <div className={`mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground ${outgoing ? 'justify-end' : ''}`}><time dateTime={row.time} title={formatDateTime(row.time)}>{new Date(row.time).toLocaleTimeString('zh-CN', {hour: '2-digit', minute: '2-digit'})}</time><span>{row.demo ? '模拟 · ' : ''}{smsLabels[row.status] || '状态待确认'}</span>
                {failure && <Button variant="link" size="sm" className="h-auto p-0 text-xs" disabled={!enabled || send.isPending} onClick={() => void send.mutateAsync({body: row.body, retryId: row.id}).catch(() => undefined)}>重试</Button>}
                {outgoing && ['UNCERTAIN','PENDING','SUBMITTING','QUEUED','SENDING','SENT'].includes(row.status) && <Button variant="link" size="sm" className="h-auto p-0 text-xs" disabled={checking.isPending} onClick={() => checking.mutate(row.id)}>查询状态</Button>}
              </div>{row.error && <p className={`mt-1 text-xs ${failure ? 'text-destructive' : 'text-muted-foreground'}`} role="status">{smsFailure(row.error)}</p>}
            </div></div>
          </li>;
        })}</ol>
        {send.isPending && <div className="mt-3 flex items-center justify-end gap-2 text-xs text-muted-foreground"><LoaderCircle className="size-3 animate-spin" />发送中…</div>}
      </>}
    </div>
    {newBelow && <div className="flex shrink-0 justify-center pb-2"><Button variant="secondary" size="sm" onClick={() => {const area = viewport.current; if(area) area.scrollTop = area.scrollHeight; bottom.current = true; setNewBelow(false); setReading(value => !value);}}><ArrowDown className="size-3" />查看最新消息</Button></div>}
    {notice && <div className="flex shrink-0 items-center gap-2 border-t px-4 py-2 text-xs text-destructive" role="status"><span className="flex-1">{notice}</span>{read.isError && <Button variant="ghost" size="sm" onClick={() => {setNotice(''); read.reset(); rerender(value => value + 1); setReading(value => !value);}}>重试已读</Button>}</div>}
    <SmsComposer enabled={enabled} reason={reason} pending={send.isPending} value={draft} onChange={onDraftChange} onSend={submit} />
  </>;
}
