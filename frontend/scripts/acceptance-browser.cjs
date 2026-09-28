// Run against a disposable local backend; never against a live company database.
const assert = require('node:assert/strict');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.TASKGO_ACCEPTANCE_URL;
assert(base && ['127.0.0.1', 'localhost'].includes(new URL(base).hostname), 'A disposable localhost URL is required');
const output = process.env.TASKGO_SCREENSHOT_DIR || process.cwd();

(async () => {
  const browser = await chromium.launch({ channel: 'chrome' });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, timezoneId: 'Asia/Taipei' });
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(`${base}/signup`);
    await page.locator('#companyName').fill('Acceptance Company');
    const username = 'acceptance_' + Date.now();
    await page.locator('#username').fill(username);
    await page.locator('#password').fill('Local-Review-Password-123');
    await page.locator('[name=acceptTerms]').check();
    await page.locator('button[type=submit]').click();
    await page.waitForURL('**/app');
    await page.goto(`${base}/today`);
    await page.getByRole('link', { name: '新增派工', exact: true }).click();
    await page.locator('#dispatch-title').fill('Acceptance repair');
    await page.locator('#dispatch-location').fill('Local test site');
    await page.locator('#dispatch-time').fill('2026-09-29T10:00');
    await page.getByRole('button', { name: '派工', exact: true }).click();
    await page.waitForURL(/\/tasks\/\d+$/);
    await page.getByText('預計完成時間：', { exact: false }).waitFor();
    const detail = await page.locator('body').innerText();
    assert.match(detail, /10:00/);
    assert(!detail.includes('上午2:00'));
    const contrast = await page.locator('.tab-bar--bottom .tab:not(.active)').first().evaluate(e => ({ text: getComputedStyle(e).color, background: getComputedStyle(e).backgroundColor }));
    assert.notEqual(contrast.text, 'rgb(255, 255, 255)');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.screenshot({ path: path.join(output, 'fixed-task-mobile.png'), fullPage: true });
    await page.setViewportSize({ width: 320, height: 740 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.setViewportSize({ width: 1440, height: 960 });
    await page.screenshot({ path: path.join(output, 'fixed-task-desktop.png'), fullPage: true });

    const session = await page.evaluate(() => ({ token: localStorage.getItem('auth_token'), workspace: localStorage.getItem('active_workspace_id') }));
    const auth = { Authorization: `Bearer ${session.token}` };
    const second = await (await page.request.post(`${base}/api/workspaces/`, { headers: auth, data: { name: 'Second Company', industry: 'repair' } })).json();
    const secondTask = await (await page.request.post(`${base}/api/tasks/create`, { headers: { ...auth, 'X-Workspace-Id': String(second.active_workspace_id) }, data: { title: 'Second company repair', location: 'Test site', description: 'Test', expected_time: '2026-09-29T02:00:00Z', status: '尚未接單', assignee_ids: [] } })).json();
    await page.request.post(`${base}/api/workspaces/${session.workspace}/activate`, { headers: auth, data: {} });
    await page.reload();
    await page.waitForTimeout(500);
    await page.route('**/workspaces/*/activate', async route => { await new Promise(r => setTimeout(r, 500)); await route.continue(); });
    await page.goto(`${base}/tasks/${secondTask.id}?ws=${second.active_workspace_id}`);
    await page.waitForFunction(() => !location.search.includes('ws='));
    await page.getByText('Second company repair', { exact: false }).first().waitFor();
    assert(!(await page.locator('body').innerText()).includes('找不到該任務'));
    assert.equal(await page.evaluate(() => localStorage.getItem('active_workspace_id')), String(second.active_workspace_id));
    await page.goto(`${base}/app`);
    await page.getByRole('link', { name: /Second company repair/ }).waitFor();
    await page.locator('.tg-switcher__button').click();
    await page.getByRole('menuitem', { name: /Acceptance Company/ }).click();
    await page.getByRole('link', { name: /Acceptance repair/ }).waitFor();
    assert(!(await page.locator('body').innerText()).includes('Second company repair'));
    assert.match(await page.getByRole('link', { name: /Acceptance repair/ }).innerText(), /10:00/);
    assert.equal(new URL(page.url()).pathname, '/app');
    await page.evaluate(() => localStorage.clear());
    await page.goto(`${base}/tasks/${secondTask.id}?ws=${second.active_workspace_id}`);
    await page.waitForURL('**/login');
    await page.locator('#username').fill(username);
    await page.locator('#password').fill('Local-Review-Password-123');
    await page.locator('button[type=submit]').click();
    await page.waitForURL(`**/tasks/${secondTask.id}`);
    await page.getByText('Second company repair', { exact: false }).first().waitFor();
    await page.goto(`${base}/tasks/${secondTask.id}?ws=999999`);
    await page.getByRole('alert').waitFor();
    assert(page.url().includes('ws=999999'));
    for (const doc of ['privacy', 'terms', 'support']) {
      await page.goto(`${base}/legal/${doc}`);
      await page.getByRole('link', { name: 'goole910805@gmail.com' }).waitFor();
      assert(!(await page.locator('body').innerText()).includes('待填'));
    }
    assert.deepEqual(errors, []);
    console.log('PASS: signup, dispatch, timezone, mobile contrast/width, company deep link, forbidden company and legal contact');
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
