/**
 * E2E test: simulate a real user flow
 * 1. Visit homepage
 * 2. Go to settings → see auth form
 * 3. Register a new user
 * 4. Login
 * 5. Add API keys
 * 6. Go back to homepage → search for places
 */
import { chromium } from 'playwright';

const BASE = 'http://localhost:3000';
const EMAIL = `test-${Date.now()}@tabimichi.test`;
const PASSWORD = 'Test1234!';

async function main() {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'es-ES' });
  const page = await ctx.newPage();

  // Capture console errors
  const errors = [];
  page.on('console', msg => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  page.on('pageerror', err => errors.push(err.message));

  console.log('=== 1. Homepage ===');
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);
  console.log('  Title:', await page.title());
  await page.screenshot({ path: '/tmp/tabi-01-home.png' });

  console.log('\n=== 2. Settings (unauthenticated) ===');
  await page.goto(`${BASE}/settings`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  const authFormVisible = await page.locator('text=Iniciar sesión').isVisible().catch(() => false);
  const registerLink = await page.locator('text=Crear una').isVisible().catch(() => false);
  console.log('  Auth form visible:', authFormVisible);
  console.log('  Register link visible:', registerLink);
  await page.screenshot({ path: '/tmp/tabi-02-settings-unauth.png' });

  console.log('\n=== 3. Register ===');
  if (registerLink) {
    await page.click('text=Crear una');
    await page.waitForTimeout(500);
  }
  await page.fill('input[type="email"]', EMAIL);
  await page.fill('input[type="password"]', PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForTimeout(3000);
  const successMsg = await page.locator('text=Cuenta creada').isVisible().catch(() => false) ||
                     await page.locator('text=confirmar').isVisible().catch(() => false);
  console.log('  Registration success:', successMsg);
  await page.screenshot({ path: '/tmp/tabi-03-register.png' });

  console.log('\n=== 4. Login ===');
  // Switch to login mode if needed
  const loginLink = await page.locator('text=Iniciar sesión').isVisible().catch(() => false);
  if (loginLink && !authFormVisible) {
    // Already on register, switch to login
    await page.click('text=Iniciar sesión');
    await page.waitForTimeout(500);
  }
  // Fill login form
  await page.fill('input[type="email"]', EMAIL);
  await page.fill('input[type="password"]', PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForTimeout(3000);
  const loggedIn = await page.locator('text=Sesión activa').isVisible().catch(() => false);
  console.log('  Logged in:', loggedIn);
  await page.screenshot({ path: '/tmp/tabi-04-loggedin.png' });

  console.log('\n=== 5. Settings (authenticated) ===');
  if (loggedIn) {
    // Check settings form is visible
    const settingsForm = await page.locator('text=Google Places').isVisible().catch(() => false);
    console.log('  Settings form visible:', settingsForm);
    await page.screenshot({ path: '/tmp/tabi-05-settings-auth.png' });
  }

  console.log('\n=== 6. Homepage with location ===');
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);
  // Type location
  const locationInput = page.locator('input').first();
  await locationInput.fill('Tokyo, Japón');
  await page.waitForTimeout(300);
  // Click search
  const searchBtn = page.locator('button:has-text("🔍")');
  await searchBtn.click();
  await page.waitForTimeout(2000);
  // Click discover
  const discoverBtn = page.locator('button:has-text("Descubrir")');
  await discoverBtn.click();
  await page.waitForTimeout(5000);
  const hasResults = await page.locator('text=Encuentra').isVisible().catch(() => false) ||
                     await page.locator('[class*="card"]').count() > 0;
  console.log('  Results visible:', hasResults);
  await page.screenshot({ path: '/tmp/tabi-06-results.png' });

  console.log('\n=== Console Errors ===');
  if (errors.length === 0) {
    console.log('  ✅ No console errors');
  } else {
    errors.forEach(e => console.log('  ❌', e.slice(0, 120)));
  }

  await browser.close();
  console.log('\n✅ E2E test complete');
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
