import { Link } from "react-router-dom";
import { useWorkspace } from "../app/WorkspaceProvider";
import { canRenew, formatDate, leaseModel, leasePath, sortedLeases } from "../lib/models";
import { EmptyNumbers, Heading, Icon, LeaseBadge, LeaseSwitcher, OrderSummary, SelectionGuard } from "../components/ui";
import { Button } from "../components/ui/button";
import { Badge } from "../components/ui/badge";
import { Card, CardContent } from "../components/ui/card";
import { Progress } from "../components/ui/progress";

export function SubscriptionPage() {
  const { data, busy, openRenew, selectLease } = useWorkspace();
  const lease = data!.lease;
  if (!lease)
    return (
      <main className="content subscription-content">
        <Heading title="套餐与续费" action />
        <EmptyNumbers />
      </main>
    );
  const model = leaseModel(lease), allowed = canRenew(data!);
  const latestOrder = data!.bills
    .filter(order => order.leaseId === lease.id)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  const quota = lease.smsSendQuota;
  const hasSmsQuota = quota && Number.isFinite(quota.total) && quota.total > 0
    && Number.isFinite(quota.used) && quota.used >= 0
    && Number.isFinite(quota.remaining) && quota.remaining >= 0;
  const renewalNote = lease.historicalOnly ? "归档租约仅供查看历史记录，不能在线续费。"
    : allowed ? lease.status === "EXPIRED_HELD" ? "号码仍为你保留；确认后从当前时间开始新租期，到期后的空窗不会补卖。" : ""
    : model.status === "unknown" ? "租期数据不完整，暂不能续费。" : "号码已释放或结束，暂不能续费。";
  return (
    <main className="content subscription-content">
      <div className="subscription-header">
        <Heading title="套餐与续费" action />
        <div className="subscription-switcher">
          <span>管理号码</span>
          <LeaseSwitcher />
        </div>
      </div>
      <SelectionGuard className="subscription-selection">
        <Card className="subscription-lease-card" role="region" aria-labelledby="subscription-lease-title">
          <CardContent className="subscription-lease-layout">
            <div className="subscription-lease-info">
              <div className="subscription-card-heading">
                <h2 id="subscription-lease-title">当前租赁</h2>
                <LeaseBadge lease={lease} />
                {lease.demo && <Badge variant="outline">演示环境</Badge>}
              </div>
              <p className="subscription-phone">{lease.number}</p>
              <p className="subscription-location">{lease.countryName} · {lease.regionName}</p>
              <dl className="subscription-dates">
                <div><dt>开始日期</dt><dd><time dateTime={lease.startedAt}>{formatDate(lease.startedAt)}</time></dd></div>
                <div><dt>到期日期</dt><dd><time dateTime={lease.expiresAt}>{formatDate(lease.expiresAt)}</time></dd></div>
              </dl>
            </div>
            <div className={`subscription-remaining ${model.status}`}>
              <span>剩余租期</span>
              <p><strong>{model.remaining ?? "未知"}</strong>{model.remaining !== null && <span>天</span>}</p>
              <small>{model.status === "expired" ? "已到期" : model.status === "unknown" ? "租期待确认" : "从当前到期日顺延续费"}</small>
            </div>
            <div className="subscription-actions" role="group" aria-label="快捷操作">
              <Button data-action="renew" disabled={!allowed || busy} aria-describedby={renewalNote ? "subscription-renew-note" : undefined} onClick={() => openRenew()}>
                <Icon name="refresh-cw" />续费
              </Button>
              <Button asChild variant="ghost"><Link to={leasePath("numbers", lease.id)}>号码详情<Icon name="arrow-right" /></Link></Button>
            </div>
          </CardContent>
          {renewalNote && <p id="subscription-renew-note" className="subscription-renew-note"><Icon name="circle-help" />{renewalNote}</p>}
        </Card>
        {hasSmsQuota && quota && <Card className="subscription-usage-card" role="region" aria-labelledby="subscription-usage-title">
          <CardContent>
            <div className="subscription-card-heading"><h2 id="subscription-usage-title">短信发送额度</h2></div>
            <div className="subscription-resource-values">
              <p><strong>{quota.used.toLocaleString()}</strong><span> / {quota.total.toLocaleString()} 条</span></p>
              <Progress value={Math.min(100, Math.max(0, quota.used / quota.total * 100))} aria-label="短信发送额度使用情况" aria-valuetext={`已用 ${quota.used} 条，共 ${quota.total} 条，剩余 ${quota.remaining} 条`} />
              <small>剩余 {quota.remaining.toLocaleString()} 条发送额度</small>
            </div>
          </CardContent>
        </Card>}
        {data!.leases.length > 1 && <Card className="subscription-all-card" role="region" aria-labelledby="subscription-all-title">
          <CardContent>
            <div className="subscription-card-heading"><h2 id="subscription-all-title">全部租约 · 按到期时间</h2></div>
            <ul className="subscription-all-list">
              {sortedLeases(data!.leases).map(item => {
                const itemModel = leaseModel(item);
                return <li key={item.id} className={item.id === lease.id ? "current" : ""}>
                  <span><strong>{item.number}</strong><small>{item.countryName} · {item.regionName}</small></span>
                  <LeaseBadge lease={item} />
                  <span className="subscription-all-expiry"><small>到期</small><time dateTime={item.expiresAt}>{formatDate(item.expiresAt)}</time></span>
                  <span className="subscription-all-remaining">{itemModel.status === "expired" ? "已到期" : itemModel.remaining === null ? "待确认" : `剩余 ${itemModel.remaining} 天`}</span>
                  {item.id === lease.id ? <span className="subscription-all-current">当前</span> : <Button variant="outline" size="sm" disabled={busy} onClick={() => selectLease(item.id)}>管理</Button>}
                </li>;
              })}
            </ul>
          </CardContent>
        </Card>}
        <Card className="subscription-recent-card" role="region" aria-labelledby="subscription-recent-title">
          <CardContent>
            <div className="subscription-card-heading">
              <h2 id="subscription-recent-title">最近订单</h2>
              <Button asChild variant="link"><Link to={leasePath("billing", lease.id)}>查看全部订单<Icon name="arrow-right" /></Link></Button>
            </div>
            {latestOrder ? <OrderSummary order={latestOrder} /> : <p className="subscription-order-empty">已载入的记录中暂无关联订单。</p>}
            {data!.truncated.bills && <p className="subscription-history-note">关联记录来自最近 200 笔账户订单。</p>}
          </CardContent>
        </Card>
      </SelectionGuard>
    </main>
  );
}
