async (page) => {
  const result = { checks: [] };
  const check = (condition, label) => { if (!condition) throw new Error(label); result.checks.push(label); };
  const read = () => page.evaluate(async () => {
    const names = ['account', 'catalog', 'dashboard', 'numbers?pageSize=100', 'orders?pageSize=100', 'inbox?pageSize=100', 'points?pageSize=100'];
    const pairs = await Promise.all(names.map(async name => {
      const response = await fetch('http://127.0.0.1:3010/api/' + name, { credentials: 'include', cache: 'no-store' });
      if (!response.ok) throw new Error(name + ': HTTP ' + response.status);
      return [name.split('?')[0], await response.json()];
    }));
    return Object.fromEntries(pairs);
  });
  const ready = () => page.getByRole('button', { name: '刷新数据', exact: true }).waitFor({ state: 'visible' });
  const refresh = async () => {
    const response = page.waitForResponse(r => r.url().includes('/api/points?') && r.request().method() === 'GET');
    await page.getByRole('button', { name: '刷新数据', exact: true }).click();
    await response;
    await page.waitForFunction(() => !document.querySelector('button[aria-label="刷新数据"]:disabled'));
  };
  try {
    await page.evaluate(() => { window.location.hash = '#workspace-reference-shell/purchase'; });
    await page.getByRole('heading', { name: '购买号码', exact: true }).waitFor();
    await ready();
    const before = await read();
    const offer = before.catalog.data.offers.find(x => x.region === 'us' && x.service === 'Telegram' && x.plan === 'month');
    check(before.catalog.data.regions.length === 6 && before.catalog.data.offers.length === 36, 'API catalog: 6 regions / 36 offers');
    await page.getByRole('radio', { name: 'Telegram', exact: true }).check();
    await page.getByRole('spinbutton', { name: '购买数量' }).fill('1');
    check((await page.getByRole('complementary', { name: '订单摘要' }).innerText()).includes(offer.unitPoints + ' 积分'), 'Purchase price is the API offer price');
    result.before = { balance: before.account.data.pointsBalance, orders: before.orders.pagination.totalItems, numbers: before.numbers.pagination.totalItems, messages: before.inbox.pagination.totalItems, unread: before.dashboard.data.unreadMessages, stock: offer.availableCount };
    await page.screenshot({ path: 'linepool-ui/output/playwright/02-purchase-desktop.png', fullPage: true });
    const createdResponse = page.waitForResponse(r => new URL(r.url()).pathname === '/api/orders' && r.request().method() === 'POST');
    await page.getByRole('button', { name: '创建订单', exact: true }).click();
    const response = await createdResponse;
    const input = response.request().postDataJSON();
    const created = (await response.json()).data;
    check(response.status() === 201, 'Browser order creation: HTTP 201');
    await page.getByRole('heading', { name: '订单已创建', exact: true }).waitFor();
    const after = await read();
    result.order = { id: created.id, number: created.orderNumber, totalPoints: created.totalPoints, assignedNumber: created.numbers[0].phoneNumber };
    result.after = { balance: after.account.data.pointsBalance, orders: after.orders.pagination.totalItems, numbers: after.numbers.pagination.totalItems, messages: after.inbox.pagination.totalItems, unread: after.dashboard.data.unreadMessages, stock: after.catalog.data.offers.find(x => x.region === 'us' && x.service === 'Telegram' && x.plan === 'month').availableCount };
    check(result.after.balance === result.before.balance - offer.unitPoints, 'Balance deducted exactly once');
    check(result.after.orders === result.before.orders + 1 && result.after.numbers === result.before.numbers + 1, 'Order and assigned number persisted');
    check(result.after.stock === result.before.stock - 1, 'Catalog inventory refreshed');
    check(after.points.data.balance === result.after.balance && after.points.data.entries.some(x => x.referenceId === created.id && x.delta === -created.totalPoints), 'Points ledger references the new order');
    const replay = await page.evaluate(async input => {
      const response = await fetch('http://127.0.0.1:3010/api/orders', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) });
      const body = await response.json();
      return { status: response.status, id: body.data?.id };
    }, input);
    const replayState = await read();
    check(replay.id === created.id && replayState.account.data.pointsBalance === result.after.balance && replayState.orders.pagination.totalItems === result.after.orders, 'Idempotent retry: same order, no duplicate debit');
    await page.screenshot({ path: 'linepool-ui/output/playwright/03-order-created-desktop.png', fullPage: true });
    await page.getByRole('navigation', { name: '号码与订单' }).getByRole('link', { name: '订单记录', exact: true }).click();
    await page.getByRole('heading', { name: '订单记录', exact: true }).waitFor();
    await refresh();
    const summary = page.locator('summary').filter({ hasText: created.orderNumber });
    await summary.click();
    await page.getByText(created.numbers[0].phoneNumber, { exact: true }).waitFor();
    check(await summary.isVisible(), 'Orders refresh and API order detail loaded');
    await page.screenshot({ path: 'linepool-ui/output/playwright/04-orders-desktop.png', fullPage: true });
    await page.getByRole('navigation', { name: '号码与订单' }).getByRole('link', { name: '我的号码', exact: true }).click();
    await page.getByText(created.numbers[0].phoneNumber, { exact: true }).waitFor();
    await refresh();
    check(await page.getByText(created.numbers[0].phoneNumber, { exact: true }).isVisible(), 'Numbers refresh includes assigned number');
    await page.getByRole('navigation', { name: '号码与订单' }).getByRole('link', { name: '积分明细', exact: true }).click();
    await page.getByRole('heading', { name: '积分明细', exact: true }).waitFor();
    await refresh();
    const debit = after.points.data.entries.find(x => x.referenceId === created.id);
    const debitRow = page.getByRole('region', { name: '积分流水' }).getByRole('row').filter({ hasText: debit.description }).filter({ hasText: debit.balanceAfter.toLocaleString('zh-CN') });
    check((await debitRow.innerText()).includes(String(debit.delta)), 'Points page refresh includes new debit');
    await page.screenshot({ path: 'linepool-ui/output/playwright/05-points-desktop.png', fullPage: true });
    await page.getByRole('navigation', { name: '主导航' }).getByRole('link', { name: /^短信收件箱/ }).click();
    await page.getByRole('heading', { name: '短信收件箱', exact: true }).waitFor();
    await refresh();
    const unread = after.inbox.data.find(x => !x.isRead);
    if (unread) {
      const readResponse = page.waitForResponse(r => r.url().endsWith('/api/inbox/read') && r.request().method() === 'POST');
      await page.getByRole('region', { name: '短信列表' }).getByRole('button').filter({ hasText: unread.verificationCode }).click();
      check((await readResponse).ok(), 'SMS marked read through API');
      await page.getByRole('region', { name: '短信详情' }).getByText('已读', { exact: true }).waitFor();
      const smsState = await read();
      check(smsState.dashboard.data.unreadMessages === result.after.unread - 1 && smsState.inbox.data.find(x => x.id === unread.id).isRead, 'SMS read status and unread count refreshed');
      await page.reload();
      await page.getByRole('heading', { name: '短信收件箱', exact: true }).waitFor();
      const persisted = await read();
      check(persisted.inbox.data.find(x => x.id === unread.id).isRead, 'SMS read survives full reload');
      result.unreadAfterRead = persisted.dashboard.data.unreadMessages;
    }
    await page.screenshot({ path: 'linepool-ui/output/playwright/06-inbox-desktop.png', fullPage: true });
    await page.getByRole('navigation', { name: '主导航' }).getByRole('link', { name: '账户设置', exact: true }).click();
    await page.getByRole('heading', { name: '账户设置', exact: true }).waitFor();
    const originalPreference = (await read()).account.data.preferences.expiryNotice;
    const preferenceResponse = page.waitForResponse(r => r.url().endsWith('/api/account/preferences') && r.request().method() === 'PATCH');
    await page.getByRole('checkbox').click();
    check((await preferenceResponse).ok(), 'Account preference saved through API');
    await page.getByText('偏好已保存', { exact: true }).waitFor();
    await page.reload();
    await page.getByRole('heading', { name: '账户设置', exact: true }).waitFor();
    check(await page.getByRole('checkbox').isChecked() === !originalPreference, 'Account preference survives reload');
    await page.getByRole('checkbox').click();
    await page.getByText('偏好已保存', { exact: true }).waitFor();
    await page.getByRole('navigation', { name: '主导航' }).getByRole('link', { name: '工作台', exact: true }).click();
    await page.getByRole('heading', { name: '欢迎回来，' + before.account.data.displayName, exact: true }).waitFor();
    await page.screenshot({ path: 'linepool-ui/output/playwright/07-dashboard-desktop.png', fullPage: true });
    check(!(await page.locator('vite-error-overlay').count()), 'No Vite overlay after reload and navigation');
    return result;
  } catch (failure) {
    throw new Error(String(failure) + '\nAcceptance state: ' + JSON.stringify(result));
  }
}
