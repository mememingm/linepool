async (page) => {
  const result = { checks: [] };
  const check = (condition, label) => { if (!condition) throw new Error(label); result.checks.push(label); };
  const read = () => page.evaluate(async () => {
    const names = ['account', 'dashboard', 'inbox?pageSize=100', 'points?pageSize=100', 'orders?pageSize=100'];
    return Object.fromEntries(await Promise.all(names.map(async name => {
      const response = await fetch('http://127.0.0.1:3010/api/' + name, { credentials: 'include', cache: 'no-store' });
      if (!response.ok) throw new Error(name + ': HTTP ' + response.status);
      return [name.split('?')[0], await response.json()];
    })));
  });
  const refresh = async () => {
    const response = page.waitForResponse(r => r.url().includes('/api/points?') && r.request().method() === 'GET');
    await page.getByRole('button', { name: '刷新数据', exact: true }).click();
    await response;
    await page.waitForFunction(() => !document.querySelector('button[aria-label="刷新数据"]:disabled'));
  };
  try {
    await page.getByRole('heading', { name: '积分明细', exact: true }).waitFor();
    const state = await read();
    const created = state.orders.data[0];
    const debit = state.points.data.entries.find(x => x.referenceId === created.id);
    const debitRow = page.getByRole('region', { name: '积分流水' }).getByRole('row').filter({ hasText: debit.description }).filter({ hasText: debit.balanceAfter.toLocaleString('zh-CN') });
    check((await debitRow.innerText()).includes(String(debit.delta)), 'Points page includes the API order debit and balance');
    await page.screenshot({ path: 'linepool-ui/output/playwright/05-points-desktop.png', fullPage: true });
    await page.getByRole('navigation', { name: '主导航' }).getByRole('link', { name: /^短信收件箱/ }).click();
    await page.getByRole('heading', { name: '短信收件箱', exact: true }).waitFor();
    await refresh();
    const unread = state.inbox.data.find(x => !x.isRead);
    if (unread) {
      const readResponse = page.waitForResponse(r => r.url().endsWith('/api/inbox/read') && r.request().method() === 'POST');
      await page.getByRole('region', { name: '短信列表' }).getByRole('button').filter({ hasText: unread.verificationCode }).click();
      check((await readResponse).ok(), 'SMS marked read through API');
      await page.getByRole('region', { name: '短信详情' }).getByText('已读', { exact: true }).waitFor();
      const smsState = await read();
      check(smsState.dashboard.data.unreadMessages === state.dashboard.data.unreadMessages - 1 && smsState.inbox.data.find(x => x.id === unread.id).isRead, 'SMS status and unread count refreshed');
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
    check(await page.getByRole('checkbox').isChecked() === !originalPreference, 'Preference survives reload');
    await page.getByRole('checkbox').click();
    await page.getByText('偏好已保存', { exact: true }).waitFor();
    await page.getByRole('navigation', { name: '主导航' }).getByRole('link', { name: '工作台', exact: true }).click();
    await page.getByRole('heading', { name: '欢迎回来，' + state.account.data.displayName, exact: true }).waitFor();
    await page.screenshot({ path: 'linepool-ui/output/playwright/07-dashboard-desktop.png', fullPage: true });
    check(!(await page.locator('vite-error-overlay').count()), 'No Vite overlay');
    return result;
  } catch (failure) { throw new Error(String(failure) + '\nAcceptance state: ' + JSON.stringify(result)); }
}
