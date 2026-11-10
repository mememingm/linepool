import { Navigate, useSearchParams } from 'react-router-dom';
import { useWorkspace } from '../app/WorkspaceProvider';
import { SmsChat } from '../components/SmsChat';
import { CommunicationNav, EmptyNumbers, Heading, LeaseSwitcher } from '../components/ui';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';

export function MessagesPage() { return <SmsChat />; }
export function InboxPage() {
  const [params] = useSearchParams();
  return <Navigate to={'/app/messages?' + params.toString()} replace />;
}
export function SendPage() {
  const {data} = useWorkspace();
  const [params] = useSearchParams();
  if (params.get('compose') !== 'mms') {
    const next = new URLSearchParams(params); next.set('compose', 'sms');
    return <Navigate to={'/app/messages?' + next.toString()} replace />;
  }
  return <main className="content send-content"><Heading title="MMS" />
    {!data?.lease ? <EmptyNumbers /> : <>
      <CommunicationNav value="mms" leaseId={data.lease.id} />
      <div className="message-toolbar"><span>发送号码</span><LeaseSwitcher /></div>
      <section className="message-composer"><h2>彩信</h2><p className="my-3 text-sm text-muted-foreground">MMS 尚未接入，媒体上传和发送暂不可用。</p>
        <fieldset disabled className="space-y-4"><div><Label htmlFor="mms-recipient">接收号码</Label><Input id="mms-recipient" type="tel" /></div><div><Label htmlFor="mms-body">附加文字</Label><Textarea id="mms-body" rows={3} /></div><Button disabled>发送 MMS</Button></fieldset>
      </section>
    </>}
  </main>;
}
