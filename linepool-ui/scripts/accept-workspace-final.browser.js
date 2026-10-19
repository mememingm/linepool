async (page) => {
  const result = { checks: [] };
  const check = (condition, label) => { if (!condition) throw new Error(label); result.checks.push(label); };
  const read = () => page.evaluate(async () => {
    const paths = ['account', 'dashboard', 'orders?pageSize=100', 'numbers?pageSize=100', 'points?pageSize=100', 'inbox?pageSize=100'];
    return Object.fromEntries(await Promise.all(paths.map(async path => {
      const response = await fetch('http://127.0.0.1:3010/api/' + path, { credentials: 'include', cache: 'no-store' });
      if (!response.ok) throw new Error(path + ': HTTP ' + response.status);
      return [path.split('?')[0], await response.json()];
    })));
  });
  const navigate = async (hash, heading) => {
    await page.evaluate(value => { window.location.hash = value; }, hash);
    await page.getByRole('heading', { name: heading, exact: true }).waitFor();
  };
  try {
    await page.getByRole('heading', { name: '积分明细', exact: true }).waitFor();
    const state = await read();
    check((await page.getByRole('region', { name: '积分流水' }).innerText()).includes(state.account.data.pointsBalance.toLocaleString('zh-CN')), 'Points page refreshed after idempotent recovery');
    check(state.points.data.balance === state.account.data.pointsBalance && state.points.data.entries.reduce((sum, entry) => sum + entry.delta, 0) === state.points.data.balance, 'Account balance equals persistent ledger sum');
    result.state = { balance: state.account.data.pointsBalance, orders: state.orders.pagination.totalItems, numbers: state.numbers.pagination.totalItems, messages: state.inbox.pagination.totalItems, unread: state.dashboard.data.unreadMessages, expiryNotice: state.account.data.preferences.expiryNotice };
    await navigate('#workspace-reference-shell', '欢迎回来，' + state.account.data.displayName);
    await page.screenshot({ path: 'linepool-ui/output/playwright/09-dashboard-desktop.png', fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole('button', { name: '展开账户导航', exact: true }).click();
    await page.getByRole('navigation', { name: '主导航' }).getByRole('link', { name: '购买号码', exact: true }).click();
    await page.getByRole('heading', { name: '购买号码', exact: true }).waitFor();
    check(await page.getByRole('button', { name: '展开账户导航', exact: true }).getAttribute('aria-expanded') === 'false', 'Mobile navigation closes after route change');
    await page.screenshot({ path: 'linepool-ui/output/playwright/10-purchase-mobile.png', fullPage: true });
    result.mobilePurchase = await page.evaluate(() => ({ viewport: innerWidth, documentWidth: document.documentElement.scrollWidth }));
    check(result.mobilePurchase.documentWidth <= result.mobilePurchase.viewport, 'Mobile purchase has no horizontal page overflow');
    await navigate('#workspace-reference-shell', '欢迎回来，' + state.account.data.displayName);
    await page.screenshot({ path: 'linepool-ui/output/playwright/11-dashboard-mobile.png', fullPage: true });
    result.mobileDashboard = await page.evaluate(() => ({ viewport: innerWidth, documentWidth: document.documentElement.scrollWidth }));
    check(result.mobileDashboard.documentWidth <= result.mobileDashboard.viewport, 'Mobile dashboard has no horizontal page overflow');
    await page.setViewportSize({ width: 1440, height: 1000 });
    await navigate('#workspace-reference-shell/orders', '订单记录');
    const detailUrl = 'http://127.0.0.1:3010/api/orders/' + state.orders.data[0].id;
    await page.route(detailUrl, route => route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ error: { code: 'ORDER_NOT_FOUND', message: 'test not found' } }) }));
    const summary = page.locator('summary').filter({ hasText: state.orders.data[0].orderNumber });
    await summary.click();
    const order = page.locator('article').filter({ has: summary });
    await order.getByRole('alert').getByText('订单不存在', { exact: false }).waitFor();
    check(await summary.isVisible(), 'Missing order detail leaves list visible with error and retry');
    await page.unroute(detailUrl);
    await order.getByRole('button', { name: '重试', exact: true }).click();
    const response = await page.evaluate(async url => (await (await fetch(url, { credentials: 'include' })).json()).data, detailUrl);
    await order.getByText(response.numbers[0].phoneNumber, { exact: true }).waitFor();
    result.checks.push('Order detail recovers with real API on retry');
    await navigate('#workspace-reference-shell/account', '我的账户');
    await page.route('http://127.0.0.1:3010/api/account', route => route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ error: { code: 'UNAUTHENTICATED', message: 'expired' } }) }));
    await page.locator('.lp-shell-view-header').getByRole('button', { name: '刷新数据', exact: true }).click();
    await page.getByRole('heading', { name: '登录账户', exact: true }).waitFor();
    await page.getByRole('alert').getByText('登录已过期，请重新登录', { exact: true }).waitFor();
    check(!(await page.getByRole('navigation', { name: '主导航' }).count()), '401 clears protected account view');
    await page.unroute('http://127.0.0.1:3010/api/account');
    await page.reload();
    await page.getByRole('heading', { name: '我的账户', exact: true }).waitFor();
    const logout = page.waitForResponse(r => r.url().endsWith('/api/auth/logout'));
    await page.getByRole('button', { name: '退出登录', exact: true }).click();
    check((await logout).ok(), 'Logout invalidates server session');
    await page.getByRole('heading', { name: '登录账户', exact: true }).waitFor();
    await page.reload();
    await page.getByRole('heading', { name: '登录账户', exact: true }).waitFor();
    check(!(await page.getByRole('navigation', { name: '主导航' }).count()), 'Logged-out reload cannot access private records');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: 'linepool-ui/output/playwright/12-login-mobile.png', fullPage: true });
    check(!(await page.locator('vite-error-overlay').count()), 'No Vite error overlay');
    return result;
  } catch (failure) {
    await page.screenshot({ path: 'linepool-ui/output/playwright/acceptance-final-failure.png', fullPage: true });
    throw new Error(String(failure) + '\nAcceptance state: ' + JSON.stringify(result));
  } finally { await page.unroute('http://127.0.0.1:3010/api/orders/*'); await page.unroute('http://127.0.0.1:3010/api/account'); }
}
