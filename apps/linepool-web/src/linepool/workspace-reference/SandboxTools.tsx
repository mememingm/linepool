import {useRef,useState} from 'react';
import {createLinepoolApi} from '../api/client';
import {ActionButton} from '../components';
import SelectField from '../SelectField';
import {apiMessage,type WorkspaceData,type WorkspaceActions} from './workspace-data';
const api=createLinepoolApi();
type Outcome='SUCCESS'|'FAILED'|'UNKNOWN';
export default function SandboxTools({data,actions,numberId}:{data:WorkspaceData;actions:WorkspaceActions;numberId?:string}){
 const enabled=data.account.sandboxEnabled===true;
 const [busy,setBusy]=useState(false),[result,setResult]=useState(''),[error,setError]=useState('');
 const [outcome,setOutcome]=useState<Outcome>('SUCCESS'),lock=useRef(false);
 const number=data.numbers.find(n=>n.id===numberId)??data.numbers.find(n=>n.status==='ACTIVE');
 const storage=`linepool:sandbox-inbound:${data.account.id}:${number?.allocationId??number?.id}`;
 const [event,setEvent]=useState(()=>{try{return JSON.parse(localStorage.getItem(storage)??'null') as {id:string;outcome:Outcome}|null;}catch{return null;}});
 async function run(work:()=>Promise<{data:{status:string}}>){
  if(lock.current)return;lock.current=true;setBusy(true);setError('');setResult('');
  try{const r=await work();setResult(({GRANTED:'测试积分已入账',ALREADY_GRANTED:'本账户已领取测试积分',SUCCEEDED:'订单已交付',FAILED:'模拟明确失败，未交付',UNCERTAIN:'结果未知，请核对；不要重新创建',IMPORTED:'沙盒短信已保存',DUPLICATE:'已核对原收件，没有重复保存'} as Record<string,string>)[r.data.status]??r.data.status);await actions.refresh();}
  catch(e){setError(apiMessage(e));}finally{lock.current=false;setBusy(false);}
 }
 function receive(resolve=false){
  if(!number)return;
  const intent=event??{id:crypto.randomUUID(),outcome};setEvent(intent);localStorage.setItem(storage,JSON.stringify(intent));
  void run(()=>api.sandboxInbound({...intent,numberId:number.id,allocationId:number.allocationId,resolve}));
 }
 if(!enabled)return null;
 return <details className="lp-shell-sandbox"><summary>本地沙盒工具</summary>
  <p>仅用于此独立测试环境。积分每账户限领 100；外部履约和收件为合成模拟。</p>
  <ActionButton size="sm" disabled={busy} onClick={()=>void run(()=>api.sandboxCredit())}>领取测试积分</ActionButton>
  {data.orders.filter(o=>o.status==='PROCESSING').map(o=><fieldset key={o.id} disabled={busy}><legend>{o.service} · {o.orderNumber}</legend>
   <ActionButton size="sm" onClick={()=>void run(()=>api.sandboxFulfill(o.id,'SUCCESS'))}>核对订单：交付成功</ActionButton>{' '}
   <ActionButton size="sm" onClick={()=>void run(()=>api.sandboxFulfill(o.id,'FAILED'))}>核对订单：明确失败</ActionButton>{' '}
   <ActionButton size="sm" onClick={()=>void run(()=>api.sandboxFulfill(o.id,'UNKNOWN'))}>模拟履约超时未知</ActionButton>
  </fieldset>)}
  {number&&<fieldset disabled={busy}><legend>收件 · {number.phoneNumber} · {number.service}</legend>
   <label>模拟收件结果 <SelectField aria-label="模拟收件结果" disabled={!!event} value={event?.outcome??outcome} onValueChange={value=>setOutcome(value as Outcome)} options={[{value:"SUCCESS",label:"成功"},{value:"FAILED",label:"明确失败"},{value:"UNKNOWN",label:"超时未知"}]} /></label>{' '}
   <ActionButton size="sm" onClick={()=>receive()}>模拟收件 / 重试原事件</ActionButton>{' '}
   {event?.outcome==='UNKNOWN'&&<ActionButton size="sm" onClick={()=>receive(true)}>核对迟到收件</ActionButton>}{' '}
   <ActionButton size="sm" disabled={event?.outcome==='UNKNOWN' && !['沙盒短信已保存','已核对原收件，没有重复保存'].includes(result)} onClick={()=>{setEvent(null);localStorage.removeItem(storage);setResult('已准备新收件事件，尚未执行');}}>准备下一条收件</ActionButton>
  </fieldset>}
  {result&&<p role="status">{result}</p>}{error&&<p role="alert">{error}</p>}
 </details>;
}
