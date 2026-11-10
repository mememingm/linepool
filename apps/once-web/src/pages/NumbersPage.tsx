import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useLayoutEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { motion, useReducedMotion } from "motion/react";
import { useWorkspace } from "../app/WorkspaceProvider";
import {
  canRenew,
  formatDate,
  formatMoney,
  leaseModel,
  leasePath,
  localDemo,
  sortedLeases,
} from "../lib/models";
import {
  CopyButton,
  EmptyNumbers,
  RENT_PATH,
  FilterTabs,
  Icon,
  LeaseBadge,
  LeaseCountdown,
  MessageRow,
  OrderSummary,
  SelectionGuard,
} from "../components/ui";
export function NumbersPage() {
  const {
    data,
    messages,
    selectedId,
    requestedId,
    selectLease,
    busy,
    openRenew,
    switching,
  } = useWorkspace();
  const [search, setSearch] = useState(""),
    [filter, setFilter] = useState("all");
  const rail = useRef<HTMLDivElement>(null),
    [scroll, setScroll] = useState({ left: false, right: false });
  const reduce = useReducedMotion(),
    leases = sortedLeases(data!.leases),
    selected = data!.lease;
  const selection = requestedId || selectedId;
  const updateScroll = () => {
    const node = rail.current;
    if (node)
      setScroll({
        left: node.scrollTop > 2,
        right: node.scrollTop + node.clientHeight < node.scrollHeight - 2,
      });
  };
  useLayoutEffect(() => {
    const card = rail.current?.querySelector<HTMLButtonElement>(
      '[aria-pressed="true"]',
    );
    if (card && rail.current) {
      const node = rail.current,
        start = card.offsetTop - 4,
        end = card.offsetTop + card.offsetHeight + 4;
      if (start < node.scrollTop || end > node.scrollTop + node.clientHeight)
        node.scrollTo({
          top:
            start < node.scrollTop
              ? Math.max(0, start)
              : end - node.clientHeight,
          behavior: reduce ? "instant" : "smooth",
        });
    }
    updateScroll();
    const observer = new ResizeObserver(updateScroll);
    if (rail.current) observer.observe(rail.current);
    return () => observer.disconnect();
  }, [selection, filter, search, leases.length, reduce]);
  const heading = (
    <header className="overview-heading numbers-heading">
      <div>
        <h1>我的号码</h1>
      </div>
      <Button asChild variant="outline"><Link className="secondary-btn" to={RENT_PATH}>
        <Icon name="plus" />
        租用新号码
      </Link></Button>
    </header>
  );
  if (!leases.length || !selected)
    return (
      <main className="content numbers-content">
        {heading}
        <EmptyNumbers />
      </main>
    );
  const filtered = leases.filter(
    (lease) =>
      (filter === "all" || leaseModel(lease).status === filter) &&
      `${lease.number} ${lease.countryName} ${lease.regionName}`
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  const tabs = [
    ["all", "全部"],
    ["active", "使用中"],
    ["warning", "即将到期"],
    ["expired", "已到期"],
  ];
  const model = leaseModel(selected),
    orders = data!.bills.filter((order) => order.leaseId === selected.id),
    quota = localDemo() ? selected.smsSendQuota : null;
  return (
    <main className="content numbers-content">
      {heading}
      <div
        className={`number-workspace ${leases.length === 1 ? "single-number" : ""}`}
      >
        {leases.length > 1 && (
          <section className="asset-list number-selector" aria-label="选择号码">
            <div className="asset-list-label">
              <div>
                <span>
                  选择号码 <b>{leases.length}</b>
                </span>
              </div>
              <div
                className={`number-scroll-controls ${!scroll.left && !scroll.right ? "is-hidden" : ""}`}
              >
                {[-1, 1].map((direction) => (
                  <Button variant="ghost"
                    key={direction}
                    className="icon-btn"
                    data-number-scroll={direction}
                    aria-label={direction < 0 ? "向上滚动号码" : "向下滚动号码"}
                    disabled={direction < 0 ? !scroll.left : !scroll.right}
                    onClick={() => {
                      const node = rail.current;
                      node?.scrollBy({
                        top: direction * node.clientHeight * 0.8,
                        behavior: reduce ? "instant" : "smooth",
                      });
                    }}
                  >
                    <Icon name="arrow-right" />
                  </Button>
                ))}
              </div>
            </div>
            <div className="asset-controls">
              <FilterTabs className="number-status-tabs" label="按号码状态筛选" value={filter} onValueChange={setFilter} options={tabs.map(([value, title]) => ({value, label: <>{title}<span>{value === "all" ? leases.length : leases.filter(lease => leaseModel(lease).status === value).length}</span></>}))} />
              <Label className="asset-search" htmlFor="lease-search">
                <Icon name="search" />
                <Input
                  type="search"
                  id="lease-search"
                  placeholder="搜索号码或地区"
                  aria-label="搜索号码或地区"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                />
              </Label>
            </div>
            <div
              className="asset-scroll"
              ref={rail}
              onScroll={updateScroll}
              role="group"
              aria-label="号码列表，可使用上下方向键切换"
              onKeyDown={(event) => {
                if (
                  !["ArrowUp", "ArrowDown", "Home", "End"].includes(
                    event.key,
                  ) ||
                  !(event.target instanceof HTMLButtonElement)
                )
                  return;
                const cards = Array.from(
                    rail.current!.querySelectorAll<HTMLButtonElement>(
                      "[data-lease]",
                    ),
                  ),
                  index = cards.indexOf(event.target);
                const next =
                  event.key === "Home"
                    ? 0
                    : event.key === "End"
                      ? cards.length - 1
                      : Math.max(
                          0,
                          Math.min(
                            cards.length - 1,
                            index + (event.key === "ArrowDown" ? 1 : -1),
                          ),
                        );
                event.preventDefault();
                cards[next]?.focus({ preventScroll: true });
                cards[next]?.click();
              }}
            >
              {filtered.length ? (
                filtered.map((lease) => (
                  <Button variant="ghost"
                    key={lease.id}
                    className={`asset-row ${lease.id === selection ? "selected" : ""}`}
                    data-lease={lease.id}
                    aria-pressed={lease.id === selection}
                    disabled={busy}
                    onClick={() => selectLease(lease.id)}
                  >
                    <div className="number-card-top"><strong className="number-card-phone">{lease.number}</strong><LeaseBadge lease={lease} /></div>
                    <span>
                      {lease.countryName} · {lease.regionName}
                    </span>
                    <small>
                      {lease.term} 天套餐 ·{" "}
                      {leaseModel(lease).status === "expired"
                        ? "历史租约"
                        : leaseModel(lease).remaining === null
                          ? "租期待确认"
                          : `剩余 ${leaseModel(lease).remaining} 天`}
                      {typeof lease.unreadCount === "number" && (
                        <b>{lease.unreadCount} 未读</b>
                      )}
                    </small>
                  </Button>
                ))
              ) : (
                <div className="list-empty">
                  <h3>没有匹配号码</h3>
                  <p>试试其他号码、地区或状态。</p>
                  <Button variant="outline"
                    className="secondary-btn"
                    onClick={() => {
                      setSearch("");
                      setFilter("all");
                    }}
                  >
                    清除筛选
                  </Button>
                </div>
              )}
            </div>
          </section>
        )}
        <SelectionGuard>
          <section
            className="asset-detail"
            tabIndex={0}
            aria-label="选中号码详情"
            data-lease-detail={selected.id}
            aria-busy={switching}
          >
            <motion.div
              className="number-detail-content"
              key={selected.id}
              initial={{ opacity: reduce ? 1 : 0.65, y: reduce ? 0 : 3 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: reduce ? 0 : 0.18 }}
            >
              <section className="numbers-hero" aria-label="当前号码与租期">
                <div className="numbers-hero-main">
                  <div className="numbers-kicker">
                    <span className="numbers-phone-icon">
                      <Icon name="smartphone" />
                    </span>
                    <span>当前号码</span>
                    <LeaseBadge lease={selected} />
                    <Dialog>
                      <DialogTrigger asChild>
                        <Button variant="ghost" size="sm" className="lease-details-trigger">
                          <Icon name="receipt-text" />租赁详情
                        </Button>
                      </DialogTrigger>
                      <DialogContent className="once-dialog lease-details-dialog">
                        <DialogHeader>
                          <DialogTitle>租赁详情</DialogTitle>
                          <DialogDescription>{selected.number} · {selected.countryName} · {selected.regionName}</DialogDescription>
                        </DialogHeader>
                        <dl className="lease-details-list">
                          <div><dt>租赁开始</dt><dd>{formatDate(selected.startedAt)}</dd></div>
                          <div><dt>套餐费用</dt><dd>{formatMoney(selected.price, selected.currency)}</dd></div>
                          <div><dt>自动续费</dt><dd>未开启</dd></div>
                          <div><dt>租约编号</dt><dd>{selected.id}</dd></div>
                        </dl>
                        <div className="modal-foot"><DialogClose asChild><Button variant="outline">关闭</Button></DialogClose></div>
                      </DialogContent>
                    </Dialog>
                  </div>
                  <div className="number-title">
                    <h2 className="lease-phone">{selected.number}</h2>
                    <CopyButton
                      value={selected.number}
                      className="icon-btn copy-number"
                      aria-label="复制号码"
                      title="复制号码"
                    />
                  </div>
                  <p className="numbers-location">
                    {selected.countryName}
                    <span>·</span>
                    {selected.regionName}
                  </p>
                  <div className="detail-actions">
                    <Button asChild variant="default"><Link
                      className="primary-btn"
                      to={leasePath("inbox", selected.id)}
                    >
                      <Icon name="message-square-text" />
                      查看短信
                    </Link></Button>
                    <Button variant="outline"
                      className="secondary-btn"
                      data-action="renew"
                      disabled={!canRenew(data!) || busy}
                      onClick={() => openRenew()}
                    >
                      <Icon name="refresh-cw" />
                      同号续费
                    </Button>
                  </div>
                  {model.status !== "active" && (
                    <p className="numbers-state-note">
                      {model.status === "expired"
                        ? "历史租约，收件已停止。已保存的短信仍可查看。"
                        : model.status === "warning"
                          ? `将在 ${model.remaining} 天内到期，请及时处理租期。`
                          : "租期数据暂不完整，请刷新后查看。"}
                    </p>
                  )}
                </div>
                <LeaseCountdown lease={selected} />
              </section>
              <Tabs defaultValue="overview" className="number-detail-tabs">
                <TabsList aria-label="号码详情分类">
                  <TabsTrigger value="overview">号码概览</TabsTrigger>
                  <TabsTrigger value="orders">关联订单</TabsTrigger>
                </TabsList>
                <TabsContent value="overview" className="number-overview-panel">
              <div className="numbers-facts" aria-label="当前租约信息">
                <div>
                  <span>当前套餐</span>
                  <strong>{selected.term} 天独享</strong>
                </div>
                <div>
                  <span>已接收 SMS</span>
                  <strong>
                    {data!.messageCount}
                    <small> 条</small>
                  </strong>
                </div>
                <div>
                  <span>租赁开始</span>
                  <strong>{formatDate(selected.startedAt)}</strong>
                </div>
              </div>
              <section
                className="numbers-capabilities"
                aria-label="号码能力状态"
              >
                {[
                  [
                    "message-square-text",
                    "接收 SMS",
                    model.status === "expired" ? "已停止" : selected.demo ? "演示数据" : "等待接入",
                    model.status === "expired" ? "expired" : "pending",
                  ],
                  ["arrow-right", "发送 SMS", selected.smsSend?.enabled ? selected.smsSend.demo ? "演示可用" : "可用" : model.status === "expired" ? "已停止" : "未启用", selected.smsSend?.enabled ? "active" : "pending"],
                  ["image", "彩信 MMS", "即将推出", "pending"],
                  ["phone", "语音 Voice", "即将推出", "pending"],
                ].map(([symbol, title, label, status]) => (
                  <div className={`numbers-capability ${status}`} key={title}>
                    <span className="numbers-capability-icon">
                      <Icon name={symbol} />
                    </span>
                    <span>
                      {title}
                      <small>{label}</small>
                    </span>
                  </div>
                ))}
              </section>
              <section className="numbers-overview-messages" aria-labelledby="numbers-overview-messages-title">
                <div className="section-row">
                  <h2 id="numbers-overview-messages-title">最近短信</h2>
                  <Button asChild variant="link"><Link className="link-btn" to={leasePath("inbox", selected.id)}>查看全部<Icon name="arrow-right" /></Link></Button>
                </div>
                {messages.length ? messages.slice(0, 3).map((message) => <MessageRow key={message.id} message={message} />) : (
                  <div className="numbers-related-empty"><Icon name="message-square-text" /><h3>还没有收到短信</h3><p>在目标平台用这个号码请求验证码后，短信会出现在这里。</p></div>
                )}
              </section>
              {quota && (
                <div className="send-quota">
                  <span>发送额度 · 未启用</span>
                  <strong>
                    {quota.remaining} / {quota.total} 条剩余
                  </strong>
                  <small>已使用 {quota.used} 条，接收 SMS 不扣减此额度</small>
                </div>
              )}
                </TabsContent>
                <TabsContent value="orders" className="number-related">
                <section className="numbers-related-panel">
                  <div className="section-row">
                    <div>
                      <h2>租赁与续费</h2>
                    </div>
                    <Button asChild variant="link"><Link
                      className="link-btn"
                      to={leasePath("billing", selected.id)}
                    >
                      订单详情
                      <Icon name="arrow-right" />
                    </Link></Button>
                  </div>
                  {orders.length ? (
                    orders
                      .slice(0, 2)
                      .map((order) => (
                        <OrderSummary key={order.id} order={order} />
                      ))
                  ) : (
                    <div className="numbers-related-empty">
                      <Icon name="receipt-text" />
                      <h3>暂无关联订单</h3>
                    </div>
                  )}
                  {data!.truncated.bills && (
                    <p className="card-muted">仅检索最近 200 笔账户订单。</p>
                  )}
                </section>
                </TabsContent>
              </Tabs>
            </motion.div>
          </section>
        </SelectionGuard>
      </div>
    </main>
  );
}
