import { mkdir, writeFile } from 'node:fs/promises';

process.loadEnvFile(new URL('../backend/.env', import.meta.url));
const { DEMO_EMAIL, DEMO_PASSWORD } = process.env;
if (!DEMO_EMAIL || !DEMO_PASSWORD) throw new Error('Configure DEMO_EMAIL and DEMO_PASSWORD in backend/.env first');
const output = new URL('../output/playwright/private-login.browser.js', import.meta.url);
const script = `async (page) => {
  const checks = [];
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('http://127.0.0.1:5178/#workspace-reference-shell');
  await page.getByRole('heading', { name: '登录 LINEPOOL', exact: true }).waitFor();
  await page.getByLabel('账号', { exact: true }).fill('admin');
  await page.getByLabel('密码', { exact: true }).fill('InvalidBrowserAcceptancePassword2026!');
  const invalidResponse = page.waitForResponse(r => r.url().endsWith('/api/auth/login') && r.request().method() === 'POST');
  await page.getByRole('button', { name: '登录', exact: true }).click();
  if ((await invalidResponse).status() !== 401) throw new Error('Wrong password did not return HTTP 401');
  await page.getByRole('alert').getByText('账号或密码不正确', { exact: true }).waitFor();
  checks.push('Wrong credentials rejected with HTTP 401 and visible error');
  await page.getByLabel('密码', { exact: true }).fill(${JSON.stringify(DEMO_PASSWORD)});
  const loginResponse = page.waitForResponse(r => r.url().endsWith('/api/auth/login') && r.request().method() === 'POST');
  await page.getByRole('button', { name: '登录', exact: true }).click();
  const response = await loginResponse;
  if (!response.ok()) throw new Error('Configured local account login failed');
  const user = (await response.json()).data;
  await page.getByRole('heading', { name: '欢迎回来，' + user.displayName, exact: true }).waitFor();
  checks.push('Configured local account login loads API workspace');
  await page.screenshot({ path: 'linepool-ui/output/playwright/09-dashboard-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: 'linepool-ui/output/playwright/11-dashboard-mobile.png', fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.evaluate(() => { window.location.hash = '#workspace-reference-shell/points'; });
  await page.getByRole('heading', { name: '积分明细', exact: true }).waitFor();
  checks.push('Authenticated route loads after login');
  return { checks };
}
`;
await mkdir(new URL('.', output), { recursive: true });
await writeFile(output, script, { mode: 0o600 });
console.log('Prepared ignored browser login file. Credentials are not printed.');
