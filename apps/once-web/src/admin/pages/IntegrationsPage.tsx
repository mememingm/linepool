import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { PcConnection } from "@linepool/contracts";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useApp } from "../../app/AppProvider";
import { request } from "../../lib/api";
import { pcCapability, pcStatus, startPcAuth } from "../../lib/pc";
import { adminApi, adminError, adminKeys, integrationNumbersOptions, integrationOptions } from "../api";
import { Badge, DateText, Facts, ReasonField, State, Table } from "../primitives";
import type { IntegrationConfig } from "../integrations";

function Connections({ demoMode, selfServiceConfigured }: { demoMode?: boolean; selfServiceConfigured?: boolean }) {
  const client = useQueryClient(), { notify } = useApp();
  const query = useQuery({ queryKey: [...adminKeys.all, "pc", "connections"], queryFn: ({ signal }) => request<PcConnection[]>("/admin/pc/connections", { signal }), refetchInterval: 15_000, refetchIntervalInBackground: false });
  const authorize = useMutation({ mutationFn: () => startPcAuth("SELF_SERVICE") });
  const poll = useMutation({ mutationFn: (id: string) => request(`/admin/pc/connections/${encodeURIComponent(id)}/poll`, { method: "POST", body: {} }), onSuccess: async () => { await client.invalidateQueries({ queryKey: adminKeys.all }); notify("已请求后台轮询，完成后会更新本地记录。", "success"); } });
  return <section className="oa-card oa-integration-section"><header className="oa-section-heading"><h2>本站 PinClode 连接</h2><Button disabled={selfServiceConfigured !== true || authorize.isPending} onClick={() => authorize.mutate()}>{authorize.isPending ? "正在打开授权…" : "授权 / 重登自营连接"}</Button></header>
    <p className="oa-context">自营账号需在 PinClode 开通 ONCE 应用{demoMode && "；当前使用本地模拟授权"}。代理自行登录并管理自己的连接。</p>
    {selfServiceConfigured === false && <p className="oa-warning" role="status">尚未配置平台自营连接。个人 PC 连接用于自己的资源，不会自动成为平台自营连接。</p>}
    <State query={query} columns={5} empty={query.data?.length === 0} />
    {(authorize.isError || poll.isError) && <p className="oa-error-text" role="alert">{adminError(authorize.error || poll.error)}</p>}
    {query.data && query.data.length > 0 && <Table label="本站上游连接" columns={["账号 / 所有者", "授权状态", "能力", "授权期限 / 最近同步", "操作"]}>{query.data.map(connection => <tr key={connection.id}>
      <td>{connection.externalAccountId}<small>{connection.ownerKind === "SELF_SERVICE" ? "本站自营" : `代理 ${connection.agentId}`}</small></td><td>{pcStatus[connection.status]}{connection.problem && <small role="status">{connection.problem}</small>}</td><td>{connection.enabledCapabilities.map(item => pcCapability[item]).join("、") || "未启用能力"}</td><td>访问授权 <DateText value={connection.accessExpiresAt} /><small>续期授权 <DateText value={connection.refreshExpiresAt} /></small><small>最近同步 <DateText value={connection.lastSyncedAt} /></small><small>下次轮询 <DateText value={connection.nextPollAt} /></small></td><td><Button variant="outline" size="sm" disabled={poll.isPending} onClick={() => poll.mutate(connection.id)}>请求后台轮询</Button></td>
    </tr>)}</Table>}
  </section>;
}

function Configuration({ config }: { config: IntegrationConfig }) {
  const client = useQueryClient(), { notify } = useApp();
  const [enabled, setEnabled] = useState(config.enabled);
  const [reason, setReason] = useState("");
  const operation = useRef({ signature: "", key: crypto.randomUUID() });
  const save = useMutation({ mutationFn: () => {
    const body = { enabled, reason: reason.trim() }, signature = JSON.stringify(body);
    if (operation.current.signature !== signature) operation.current = { signature, key: crypto.randomUUID() };
    return adminApi.saveIntegration(body, operation.current.key);
  }, onSuccess: async () => { await client.invalidateQueries({ queryKey: adminKeys.all }); notify("本站模拟同步开关已保存。", "success"); } });
  const checkKey = useRef(crypto.randomUUID());
  const check = useMutation({ mutationFn: () => adminApi.checkIntegration(checkKey.current, config.demoMode), onSuccess: async () => { checkKey.current = crypto.randomUUID(); await client.invalidateQueries({ queryKey: adminKeys.all }); } });
  const result = check.data ?? config.lastCheck;
  return <section className="oa-card oa-integration-section"><header className="oa-section-heading"><h2>{config.demoMode ? "本地模拟服务" : "PinClode 服务"}</h2><Badge value={config.demoMode ? "demo" : config.provider} /></header><p className="oa-context">{config.demoMode ? "本地检查读取已保存的账号与号码事实。真实接入尚不可用。" : "本地检查读取已保存的 PinClode 连接与号码事实。"}</p>
    <Facts rows={[["账号", config.accountId], ["已同步号码", config.mappedNumbers], ["接收方式", "后台轮询"], ["授权状态", (config.authorized ?? config.configured) ? "已授权" : "待授权"]]} />
    {config.demoMode && <form className="oa-integration-form" onSubmit={event => { event.preventDefault(); if (!save.isPending) save.mutate(); }}><fieldset disabled={save.isPending}><label className="oa-check-row"><input type="checkbox" checked={enabled} onChange={event => setEnabled(event.target.checked)} />启用本站模拟服务</label><ReasonField value={reason} onChange={setReason} disabled={save.isPending} suggestions={["启用本地模拟服务", "暂停模拟服务并保留历史"]} /><Button type="submit" disabled={reason.trim().length < 3}>保存开关</Button></fieldset></form>}
    <Button variant="outline" disabled={check.isPending} onClick={() => check.mutate()}>{check.isPending ? "检查中…" : "检查本地配置"}</Button>
    {(save.isError || check.isError) && <p role="alert" className="oa-error-text">{adminError(save.error || check.error)}</p>}
    {result && <><p className={result.ok ? "oa-ok" : "oa-warning"}>本地配置{result.ok ? "检查通过" : "需要处理"}{result.code ? `（${result.code}）` : ""}</p><Facts rows={[["检查时间", <DateText value={result.checkedAt} />], ["资源数", result.resourceCount], ["需核对资源", result.invalidResources]]} /></>}
  </section>;
}

function Inventory({ config }: { config: IntegrationConfig }) {
  const client = useQueryClient(), { notify } = useApp();
  const query = useQuery(integrationNumbersOptions());
  const operation = useRef(crypto.randomUUID());
  const sync = useMutation({ mutationFn: () => adminApi.syncIntegration("FULL", "管理员请求后台同步本站号码", operation.current), onSuccess: async () => { operation.current = crypto.randomUUID(); await client.invalidateQueries({ queryKey: adminKeys.all }); notify("同步任务已登记，请等待后台处理。", "success"); } });
  return <section className="oa-card oa-integration-section"><header className="oa-section-heading"><h2>号码同步</h2><Button variant="outline" disabled={!config.configured || sync.isPending} onClick={() => sync.mutate()}><RefreshCw />{sync.isPending ? "登记中…" : "请求后台同步"}</Button></header>
    <p className="oa-context">只读取本地号码列表。购买、上游续期和划拨由 PinClode 完成，后台同步资源的最新状态。</p>
    {config.lastSync && <Facts rows={[["最近任务", config.lastSync.taskId], ["状态", config.lastSync.status], ["开始时间", <DateText value={config.lastSync.createdAt} />], ["完成时间", <DateText value={config.lastSync.finishedAt} />]]} />}
    {sync.isError && <p role="alert" className="oa-error-text">{adminError(sync.error)}</p>}
    <State query={query} empty={query.data?.items.length === 0} />
    {query.data && query.data.items.length > 0 && <Table label="本地已同步号码" columns={["号码 / 上游 ID", "状态", "资源到期", "地区"]}>{query.data.items.map(number => <tr key={number.id}><td>{number.phoneNumber}<small>{number.providerNumberId || "未绑定"}</small></td><td><Badge value={number.status} /></td><td><DateText value={number.resourceExpiresAt} /></td><td>{number.regionName || "未提供"}</td></tr>)}</Table>}
  </section>;
}

export function IntegrationsPage() {
  const query = useQuery({ ...integrationOptions(), refetchInterval: 15_000, refetchIntervalInBackground: false });
  return <><Connections demoMode={query.data?.demoMode} selfServiceConfigured={query.data?.configured} /><State query={query} columns={2} />{query.data && (query.data.configured
    ? <div className="oa-integration-grid"><Configuration key={`${query.data.accountId}:${query.data.enabled}`} config={query.data} /><Inventory config={query.data} /></div>
    : <section className="oa-card oa-integration-section"><header className="oa-section-heading"><h2>平台自营服务尚未配置</h2><Badge value="NOT_CONNECTED" /></header><p className="oa-context">管理员登录与个人连接已经独立提供。配置专用平台账号并完成授权后，才能启用自营号码租赁和短信同步；已有用户及历史记录可继续查看。</p></section>)}</>;
}
