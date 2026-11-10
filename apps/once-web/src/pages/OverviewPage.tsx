import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useWorkspace } from "../app/WorkspaceProvider";
import { leaseModel, leasePath, sortedLeases } from "../lib/models";
import {
  AccountStats,
  CopyButton,
  EmptyNumbers,
  Icon,
  LeaseBadge,
  LeaseCountdown,
  MessageRow,
  RENT_PATH,
  SelectionGuard,
} from "../components/ui";
export function OverviewPage() {
  const { data, messages, selectedId, requestedId, selectLease, busy } =
    useWorkspace();
  const leases = sortedLeases(data!.leases),
    lease = data!.lease;
  const numberList = useRef<HTMLDivElement>(null);
  const [pageSize, setPageSize] = useState(3);
  const [page, setPage] = useState(0);
  const pageCount = Math.max(1, Math.ceil(leases.length / pageSize));
  const pageIndex = Math.min(page, pageCount - 1);
  const pageStart = pageIndex * pageSize;
  const selectedIndex = leases.findIndex(item => item.id === (requestedId || selectedId));
  useLayoutEffect(() => {
    const node = numberList.current;
    if (!node) return;
    const resize = () => {
      const desktop = window.matchMedia("(min-width:1100px) and (min-height:680px)").matches;
      const row = node.querySelector<HTMLElement>(".overview-number-row");
      const rowHeight = row?.getBoundingClientRect().height || 64;
      const gap = parseFloat(getComputedStyle(node).rowGap) || 0;
      setPageSize(desktop ? Math.max(1, Math.min(4, Math.floor((node.clientHeight + gap) / (rowHeight + gap)))) : 3);
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(node);
    window.addEventListener("resize", resize);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", resize);
    };
  }, [leases.length]);
  useEffect(() => {
    if (selectedIndex >= 0) setPage(Math.floor(selectedIndex / pageSize));
  }, [selectedIndex, pageSize]);
  const heading = (
    <header className="overview-heading">
      <div>
        <h1>欢迎回来</h1>
      </div>
      <Button asChild variant="outline"><Link className="secondary-btn" to={RENT_PATH}>
        <Icon name="plus" />
        租用新号码
      </Link></Button>
    </header>
  );
  if (!lease || !leases.length)
    return (
      <main className="content overview-content">
        {heading}
        <EmptyNumbers />
      </main>
    );
  const model = leaseModel(lease),
    expiring = leases.filter((item) => leaseModel(item).status === "warning"),
    unread = lease.unreadCount ?? 0;
  return (
    <main className="content overview-content" aria-busy="false">
      {heading}
      {expiring.length > 0 && (
        <div className="overview-expiry-banner" role="status">
          <Icon name="clock-3" />
          <span>
            <strong>{expiring.length} 个号码将在 3 天内到期</strong>
            {expiring.slice(0, 2).map((item) => item.number).join("、")}
            {expiring.length > 2 ? " 等" : ""}，到期后将停止收信。
          </span>
          <Button asChild variant="outline" size="sm"><Link to={leasePath("subscription", expiring[0].id)}>去续费</Link></Button>
        </div>
      )}
      <SelectionGuard>
        <section
          className="overview-number-hero"
          aria-label="当前号码"
          data-overview-lease={lease.id}
        >
          <div className="overview-number-info">
            <div className="overview-number-kicker">
              <span>当前号码</span>
              <LeaseBadge lease={lease} />
            </div>
            <div className="overview-number-title">
              <h2>{lease.number}</h2>
              <CopyButton
                value={lease.number}
                aria-label="复制号码"
                title="复制号码"
              />
            </div>
            <p className="overview-number-place">
              <Icon name="smartphone" />
              {lease.countryName} · {lease.regionName}
            </p>
            <div className="overview-hero-actions">
              <Button asChild variant="default"><Link className="primary-btn" to={leasePath("inbox", lease.id)}>
                <Icon name="message-square-text" />
                进入消息中心
                <Icon name="arrow-right" />
              </Link></Button>
              <Button asChild variant="ghost"><Link className="ghost-btn" to={leasePath("numbers", lease.id)}>
                管理号码
              </Link></Button>
            </div>
            {model.status !== "active" && (
              <p className="overview-lease-note">
                {model.status === "expired"
                  ? "历史租约，收件已停止；可查看已保存的消息。"
                  : model.status === "warning"
                    ? `将在 ${model.remaining} 天内到期，请前往号码详情处理租期。`
                    : "租期数据暂不完整，请刷新或查看号码详情。"}
              </p>
            )}
          </div>
          <LeaseCountdown lease={lease} />
        </section>
      </SelectionGuard>
      <AccountStats leases={leases} messageCount={data!.messageCount} unread={unread} billsCount={data!.billsCount} />
      <div className="overview-bottom">
        <section
          className="overview-recent"
          aria-labelledby="overview-recent-title"
        >
          <div className="overview-section-head">
            <h2 id="overview-recent-title">最近消息 <span>{data!.messageCount}</span></h2>
            <Button asChild variant="link"><Link className="link-btn" to={leasePath("inbox", lease.id)}>
              查看全部
              <Icon name="arrow-right" />
            </Link></Button>
          </div>
          <div className="overview-message-list">
            {messages.length ? (
              messages
                .slice(0, 3)
                .map((message) => (
                  <MessageRow key={message.id} message={message} />
                ))
            ) : (
              <div className="overview-empty-messages">
                <Icon name="message-square-text" />
                <h3>还没有收到短信</h3>
              </div>
            )}
          </div>
        </section>
        <section
          className="overview-numbers"
          aria-labelledby="overview-numbers-title"
        >
          <div className="overview-section-head">
            <h2 id="overview-numbers-title">
              我的号码 <span>{leases.length}</span>
            </h2>
            <Button asChild variant="link"><Link className="link-btn" to="/app/numbers">
              管理全部
              <Icon name="arrow-right" />
            </Link></Button>
          </div>
          <div
            className="overview-number-list"
            id="overview-number-list"
            ref={numberList}
            role="group"
            aria-label="切换总览号码"
          >
            {leases.slice(pageStart, pageStart + pageSize).map((item) => (
              <Button variant="ghost"
                key={item.id}
                className={`overview-number-row ${item.id === (requestedId || selectedId) ? "selected" : ""}`}
                data-lease={item.id}
                aria-pressed={item.id === (requestedId || selectedId)}
                title={`${item.number} · ${item.countryName} · ${item.regionName}`}
                disabled={busy}
                onClick={() => selectLease(item.id)}
              >
                <span className="overview-number-symbol">
                  <Icon name="smartphone" />
                </span>
                <span className="overview-number-row-main">
                  <strong>{item.number}</strong>
                  <small>
                    {item.countryName} · {item.regionName}
                  </small>
                </span>
                <span className="overview-number-row-status">
                  <LeaseBadge lease={item} />
                  <small>
                    {leaseModel(item).remaining === null
                      ? "租期待确认"
                      : leaseModel(item).status === "expired"
                        ? "历史租约"
                        : `剩余 ${leaseModel(item).remaining} 天`}
                  </small>
                </span>
                <Icon name="arrow-right" />
              </Button>
            ))}
          </div>
          {pageCount > 1 && <nav className="overview-number-pagination" aria-label="总览号码分页">
            <span role="status" aria-live="polite">第 {pageStart + 1}–{Math.min(pageStart + pageSize, leases.length)} 个，共 {leases.length} 个号码</span>
            <div>
              <Button variant="ghost" size="icon" aria-label="上一页号码" aria-controls="overview-number-list" disabled={pageIndex === 0} onClick={() => setPage(pageIndex - 1)}><ChevronLeft aria-hidden="true" /></Button>
              <span aria-label={`第 ${pageIndex + 1} 页，共 ${pageCount} 页`}>{pageIndex + 1} / {pageCount}</span>
              <Button variant="ghost" size="icon" aria-label="下一页号码" aria-controls="overview-number-list" disabled={pageIndex >= pageCount - 1} onClick={() => setPage(pageIndex + 1)}><ChevronRight aria-hidden="true" /></Button>
            </div>
          </nav>}
        </section>
      </div>
    </main>
  );
}
