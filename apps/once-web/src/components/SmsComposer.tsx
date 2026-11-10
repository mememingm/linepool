import { useLayoutEffect, useRef, useState } from 'react';
import { ArrowUp, LoaderCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { smsMetrics } from '../lib/sms';

export function SmsComposer({enabled, reason, pending, value = '', onChange, onSend}: {
  enabled: boolean; reason: string; pending: boolean; value?: string; onChange?: (value: string) => void; onSend: (body: string) => Promise<boolean>;
}) {
  const [body, setBody] = useState(value);
  const input = useRef<HTMLTextAreaElement>(null), submitting = useRef(false);
  const metrics = smsMetrics(body);
  useLayoutEffect(() => {
    if (!input.current) return;
    input.current.style.height = 'auto';
    input.current.style.height = Math.min(128, input.current.scrollHeight + 2) + 'px';
  }, [body]);
  async function submit() {
    if (!enabled || pending || submitting.current || !body.trim()) return;
    submitting.current = true;
    try { if (await onSend(body)) { setBody(''); onChange?.(''); } }
    finally { submitting.current = false; }
  }
  return <form className="shrink-0 border-t bg-background px-4 py-3 md:px-6" onSubmit={event => {event.preventDefault(); void submit();}}>
    {!enabled && <p className="mb-2 text-xs text-muted-foreground">{reason}</p>}
    <div className="flex items-end gap-3">
      <Textarea ref={input} rows={1} maxLength={4000} value={body} onChange={event => {setBody(event.target.value); onChange?.(event.target.value);}}
        disabled={!enabled || pending} aria-label="短信内容" placeholder="输入短信…" className="min-h-10 flex-1 resize-none rounded-2xl bg-muted/50 px-4 py-2.5 shadow-none"
        onKeyDown={event => {if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing && event.nativeEvent.keyCode !== 229) {event.preventDefault(); void submit();}}} />
      <Button type="submit" size="icon" aria-label="发送短信" disabled={!enabled || pending || !body.trim()} className="sms-send-button size-10 shrink-0 rounded-full bg-blue-600 text-white hover:bg-blue-700">
        {pending ? <LoaderCircle className="size-4 animate-spin" /> : <ArrowUp className="size-5" />}
      </Button>
    </div>
    <div className="mt-2 flex flex-wrap justify-between gap-1 text-xs text-muted-foreground"><span>{metrics.characters} 个字符 · 按 {metrics.segments} 条短信发送</span><span className="hidden md:inline">Enter 发送 · Shift + Enter 换行</span></div>
  </form>;
}
