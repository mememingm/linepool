// GSM 03.38 default alphabet and extension table (ESC consumes a second septet).
const gsmBasic = new Set(Array.from("@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà"));
const gsmExtension = new Set(Array.from("\f^{}\\[~]|€"));
export function smsMetrics(text: string) {
  let units = 0, gsm = true;
  const widths: number[] = [];
  for (const char of text) {
    if (gsmBasic.has(char)) { units++; widths.push(1); }
    else if (gsmExtension.has(char)) { units += 2; widths.push(2); }
    else { gsm = false; break; }
  }
  if (!gsm) {
    units = text.length; // UTF-16 code units: astral characters take two UCS-2/Unicode units.
    widths.splice(0, widths.length, ...Array.from(text, char => char.length));
  }
  const single = gsm ? 160 : 70, multipart = gsm ? 153 : 67;
  let segments = units ? 1 : 0;
  if (units > single) {
    segments = 1; let used = 0;
    for (const width of widths) {
      if (used + width > multipart) { segments++; used = 0; }
      used += width;
    }
  }
  return {characters: Array.from(text).length, units, encoding: gsm ? 'GSM-7' : 'Unicode', segments};
}
export const smsPeer = (value: string) => value.replace(/[\s()_-]/g, '').replace(/^\+/, '');
export const e164 = (value: string) => /^\+[1-9]\d{1,14}$/.test(value.replace(/[\s()-]/g, ''));
export const peerLabel = (value: string) => /^[1-9]\d{6,14}$/.test(value) ? '+' + value : value;
export function normalizeRecipient(value: string, countryCode: string) {
  const compact = value.trim().replace(/[\s().-]/g, '');
  if (['US', 'CA'].includes(countryCode)) {
    if (/^\d{10}$/.test(compact)) return '+1' + compact;
    if (/^1\d{10}$/.test(compact)) return '+' + compact;
  }
  return compact;
}
export function formatPeer(value: string) {
  const label = peerLabel(value);
  return label.replace(/^\+1(\d{3})(\d{3})(\d{4})$/, '+1 ($1) $2-$3');
}
export const smsLabels: Record<string, string> = {
  PENDING: '待提交', SUBMITTING: '提交中', QUEUED: '已提交上游', SENDING: '发送中', SENT: '已发送',
  DELIVERED: '已送达', UNDELIVERABLE: '无法送达', FAILED: '发送失败', UNCERTAIN: '结果待确认', RECEIVED: '已接收',
};
export function smsFailure(code: string | null) {
  return ({NUMBER_NOT_READY_FOR_SMS: '本机号码暂不可发送短信', NUMBER_NOT_FOUND: '本机号码不可用', NO_DEVICE: '号码设备离线',
    NO_SIM: '号码 SIM 卡不可用', SEND_SMS_UNAVAILABLE: '号码不支持发送短信', INSUFFICIENT_BALANCE: '上游余额不足',
    PC_REQUEST_UNCERTAIN: '上游连接中断，发送结果待确认。请查询本次状态。', PC_INVALID_RESPONSE: '上游响应不完整，发送结果待确认。',
    DEMO_SIMULATED_FAILURE: '这是一次模拟发送失败，点击重试可体验重新发送。',
    IDEMPOTENCY_RETRY_WINDOW_EXPIRED: '安全重试时限已过，请联系支持核对结果。',
    LEASE_OR_PROVIDER_UNAVAILABLE_FOR_RETRY: '租约或号码不可用，请先核对本次结果。'} as Record<string, string>)[code || ''] || code || '';
}
export interface Conversation {peer: string; body: string; time: string; unread: number; direction: string}
export interface ChatMessage {
  id: string; peer: string; direction: 'INBOUND' | 'OUTBOUND'; body: string; status: string;
  error: string | null; time: string; createdAt: string; readAt: string | null; demo: boolean;
}
export interface ChatPage {items: ChatMessage[]; nextCursor: string | null; hasMore: boolean}
