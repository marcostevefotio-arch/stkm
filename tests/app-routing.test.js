const test = require('node:test');
const assert = require('node:assert/strict');
const app = require('../src/app');

test('public portal, signup, login and application routes serve their pages', async (t) => {
  const server = app.listen(0);
  t.after(() => new Promise((resolve) => server.close(resolve)));
  await new Promise((resolve) => server.once('listening', resolve));

  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const [rootResponse, loginResponse, signupResponse, appResponse] = await Promise.all([
    fetch(baseUrl),
    fetch(`${baseUrl}/connexion`),
    fetch(`${baseUrl}/inscription?plan=2`),
    fetch(`${baseUrl}/app`),
  ]);
  const [rootHtml, loginHtml, signupHtml, appHtml] = await Promise.all([
    rootResponse.text(),
    loginResponse.text(),
    signupResponse.text(),
    appResponse.text(),
  ]);

  assert.equal(rootResponse.status, 200);
  assert.match(rootHtml, /REDAMS-STK réunit les stocks/);
  assert.match(rootHtml, /href="\/inscription"/);
  assert.doesNotMatch(rootHtml, /id="content"/);
  assert.equal(loginResponse.status, 200);
  assert.match(loginHtml, /id="loginForm"/);
  assert.match(loginHtml, /href="\/inscription"/);
  assert.equal(signupResponse.status, 200);
  assert.match(signupHtml, /id="signupForm"/);
  assert.match(signupHtml, /id="signupCart"/);
  const signupScript = await fetch(`${baseUrl}/js/signup.js`);
  assert.equal(signupScript.status, 200);
  assert.match(signupScript.headers.get('content-type'), /javascript/);
  const portalScript = await fetch(`${baseUrl}/js/portal.js`);
  assert.equal(portalScript.status, 200);
  assert.match(await portalScript.text(), /data-pricing-term/);
  const pricingStyles = await fetch(`${baseUrl}/css/pricing.css`);
  assert.equal(pricingStyles.status, 200);
  assert.match(await pricingStyles.text(), /\.pricing-choice/);
  const signupStyles = await fetch(`${baseUrl}/css/signup.css`);
  assert.equal(signupStyles.status, 200);
  assert.match(signupStyles.headers.get('content-type'), /text\/css/);
  const fontStyles = await fetch(`${baseUrl}/css/fonts.css`);
  assert.equal(fontStyles.status, 200);
  assert.match(rootResponse.headers.get('content-security-policy'), /fonts\.googleapis\.com/);
  assert.match(rootResponse.headers.get('content-security-policy'), /fonts\.gstatic\.com/);
  assert.equal(appResponse.status, 200);
  assert.match(appHtml, /id="content"/);
  assert.match(appHtml, /id="notifications-button"/);
  assert.match(appHtml, /id="title"/);
  assert.match(appHtml, /id="global-search-form"/);
  assert.match(appHtml, /\/vendor\/zxing\/zxing-browser\.min\.js/);
  assert.doesNotMatch(appHtml, /id="breadcrumb"/);
  assert.match(appHtml, /id="tenant-logo"/);
  const scannerScript = await fetch(`${baseUrl}/vendor/zxing/zxing-browser.min.js`);
  assert.equal(scannerScript.status, 200);
  assert.match(scannerScript.headers.get('content-type'), /javascript/);
  const barcodeScript = await fetch(`${baseUrl}/vendor/jsbarcode/JsBarcode.all.min.js`);
  assert.equal(barcodeScript.status, 200);
  assert.match(barcodeScript.headers.get('content-type'), /javascript/);
});

test('public signup rejects invalid input before attempting database writes', async (t) => {
  const server = app.listen(0);
  t.after(() => new Promise((resolve) => server.close(resolve)));
  await new Promise((resolve) => server.once('listening', resolve));

  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/public/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /Vérifiez les informations/);
});

test('notification API requires an authenticated user', async (t) => {
  const server = app.listen(0);
  t.after(() => new Promise((resolve) => server.close(resolve)));
  await new Promise((resolve) => server.once('listening', resolve));

  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/notifications`);
  assert.equal(response.status, 401);
});

test('general search API requires an authenticated user', async (t) => {
  const server = app.listen(0);
  t.after(() => new Promise((resolve) => server.close(resolve)));
  await new Promise((resolve) => server.once('listening', resolve));

  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/search?q=stock`);
  assert.equal(response.status, 401);
});

test('procurement APIs require an authenticated user', async (t) => {
  const server = app.listen(0);
  t.after(() => new Promise((resolve) => server.close(resolve)));
  await new Promise((resolve) => server.once('listening', resolve));

  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const [suppliers, purchases] = await Promise.all([
    fetch(`${baseUrl}/api/suppliers`),
    fetch(`${baseUrl}/api/purchases`),
  ]);
  assert.equal(suppliers.status, 401);
  assert.equal(purchases.status, 401);
});

test('patient API requires an authenticated user', async (t) => {
  const server = app.listen(0);
  t.after(() => new Promise((resolve) => server.close(resolve)));
  await new Promise((resolve) => server.once('listening', resolve));

  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/patients`);
  assert.equal(response.status, 401);
});

test('insurance API requires an authenticated user', async (t) => {
  const server = app.listen(0);
  t.after(() => new Promise((resolve) => server.close(resolve)));
  await new Promise((resolve) => server.once('listening', resolve));

  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/insurers`);
  assert.equal(response.status, 401);
  const coverageResponse = await fetch(`http://127.0.0.1:${server.address().port}/api/insurers/coverages`);
  assert.equal(coverageResponse.status, 401);
});

test('sales, cash, reports, settings, support and administration APIs require an authenticated user', async (t) => {
  const server = app.listen(0);
  t.after(() => new Promise((resolve) => server.close(resolve)));
  await new Promise((resolve) => server.once('listening', resolve));

  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const [sales, cash, reports, settings, support, adminUsers, adminAudit, platform] = await Promise.all([
    fetch(`${baseUrl}/api/sales`),
    fetch(`${baseUrl}/api/cash`),
    fetch(`${baseUrl}/api/reports`),
    fetch(`${baseUrl}/api/settings`),
    fetch(`${baseUrl}/api/support`),
    fetch(`${baseUrl}/api/admin/users`),
    fetch(`${baseUrl}/api/admin/audit`),
    fetch(`${baseUrl}/api/platform/pricing`),
  ]);
  assert.equal(sales.status, 401);
  assert.equal(cash.status, 401);
  assert.equal(reports.status, 401);
  assert.equal(settings.status, 401);
  assert.equal(support.status, 401);
  assert.equal(adminUsers.status, 401);
  assert.equal(adminAudit.status, 401);
  assert.equal(platform.status, 410);
});
