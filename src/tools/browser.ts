import { chromium, Browser, BrowserContext, Page } from 'playwright';
import path from 'path';
import fs from 'fs';

// ─── Browser Manager State ──────────────────────────────────────
let browserInstance: Browser | null = null;
let contextInstance: BrowserContext | null = null;
let activePage: Page | null = null;

// Allowed Sandbox Origins (Security Gate)
const ALLOWED_ORIGINS = [
  'http://localhost:3001',
  'http://localhost:3002',
  'http://127.0.0.1:3001',
  'http://127.0.0.1:3002',
];

export interface SnapshotElement {
  ref: number;
  tagName: string;
  type?: string;
  label?: string;
  name?: string;
  placeholder?: string;
  value?: string;
  text?: string;
  options?: string[];
  disabled?: boolean;
}

export interface DOMSnapshot {
  title: string;
  url: string;
  alerts: string[];
  elements: SnapshotElement[];
  formatted: string;
}

// ─── Launch Browser ─────────────────────────────────────────────
export async function getActivePage(options?: { headless?: boolean; slowMo?: number }): Promise<Page> {
  if (activePage && !activePage.isClosed()) {
    return activePage;
  }

  const isHeadless = options?.headless ?? (process.env.BROWSER_HEADLESS === 'true');
  const slowMo = options?.slowMo ?? (process.env.BROWSER_SLOWMO ? parseInt(process.env.BROWSER_SLOWMO) : 0);

  if (!browserInstance) {
    browserInstance = await chromium.launch({
      headless: isHeadless,
      slowMo,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });
  }

  if (!contextInstance) {
    contextInstance = await browserInstance.newContext({
      viewport: { width: 1280, height: 800 },
      ignoreHTTPSErrors: true,
    });
    
    // Strict sandbox routing - block out-of-scope navigation
    await contextInstance.route('**/*', (route) => {
      const url = new URL(route.request().url());
      
      // Block the verifier backdoor
      if (url.pathname.startsWith('/__state')) {
        console.log(`\n🛡️ Sandbox blocked hidden backdoor: ${url.href}`);
        return route.abort('accessdenied');
      }

      if (ALLOWED_ORIGINS.includes(url.origin) || url.protocol === 'data:') {
        route.continue();
      } else {
        console.log(`\n🛡️ Sandbox blocked navigation to: ${url.href}`);
        route.abort('accessdenied');
      }
    });
  }

  activePage = await contextInstance.newPage();
  return activePage;
}

// ─── Close Browser ──────────────────────────────────────────────
export async function closeBrowser(): Promise<void> {
  if (activePage && !activePage.isClosed()) {
    await activePage.close().catch(() => {});
    activePage = null;
  }
  if (contextInstance) {
    await contextInstance.close().catch(() => {});
    contextInstance = null;
  }
  if (browserInstance) {
    await browserInstance.close().catch(() => {});
    browserInstance = null;
  }
}

// ─── 1. browser_navigate ─────────────────────────────────────────
export async function browser_navigate(url: string): Promise<string> {
  let targetUrl = url.trim();

  // Handle relative paths (defaulting to ERP portal)
  if (targetUrl.startsWith('/')) {
    const port = process.env.ERP_PORT || '3001';
    targetUrl = `http://localhost:${port}${targetUrl}`;
  } else if (!targetUrl.startsWith('http://') && !targetUrl.startsWith('https://')) {
    targetUrl = `http://${targetUrl}`;
  }

  // Security Check: Sandbox Origin Restriction
  const parsed = new URL(targetUrl);
  const origin = `${parsed.protocol}//${parsed.host}`;
  const isAllowed = ALLOWED_ORIGINS.some((allowed) => allowed === origin);

  if (!isAllowed) {
    throw new Error(
      `Security Sandbox Violation: Navigation to "${targetUrl}" is blocked. Allowed origins: ${ALLOWED_ORIGINS.join(', ')}`
    );
  }

  const page = await getActivePage();
  await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 15_000 });
  // Wait briefly for any dynamic client scripts
  await page.waitForTimeout(300);

  return `Navigated to ${targetUrl} (HTTP 200, title: "${await page.title()}")`;
}

// ─── 2. browser_snapshot (DOM Ref Tree Extractor) ────────────────
export async function browser_snapshot(): Promise<DOMSnapshot> {
  const page = await getActivePage();

  const result = await page.evaluate(() => {
    // 1. Clear any prior reference attributes
    document.querySelectorAll('[data-agent-ref]').forEach((el) => el.removeAttribute('data-agent-ref'));

    // 2. Extract visible alerts / error / warning / success banners
    const alertTexts: string[] = [];
    const alertSelectors = ['.error-banner', '.error', '.success-banner', '[role="alert"]', '.alert'];
    alertSelectors.forEach((sel) => {
      document.querySelectorAll(sel).forEach((el) => {
        const htmlEl = el as HTMLElement;
        const isVisible = htmlEl.checkVisibility?.() ?? (htmlEl.getClientRects().length > 0);
        if (isVisible && htmlEl.innerText.trim()) {
          alertTexts.push(htmlEl.innerText.trim().replace(/\s+/g, ' '));
        }
      });
    });

    // 3. Find interactive elements
    const selector = 'input:not([type="hidden"]), select, textarea, button, a[href], [role="button"]';
    const rawElements = Array.from(document.querySelectorAll(selector));

    let refCounter = 1;
    const elements: Array<{
      ref: number;
      tagName: string;
      type?: string;
      disabled?: boolean;
      label?: string;
      name?: string;
      placeholder?: string;
      value?: string;
      text?: string;
      options?: string[];
    }> = [];

    for (const el of rawElements) {
      const htmlEl = el as HTMLElement;

      // Visibility check
      const style = window.getComputedStyle(htmlEl);
      const isVisible = htmlEl.checkVisibility?.() ?? (htmlEl.getClientRects().length > 0);
      if (
        !isVisible ||
        style.display === 'none' ||
        style.visibility === 'hidden' ||
        style.opacity === '0'
      ) {
        continue;
      }

      const rect = htmlEl.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) {
        continue;
      }

      // Assign deterministic numeric ref
      const currentRef = refCounter++;
      htmlEl.setAttribute('data-agent-ref', String(currentRef));

      const tagName = htmlEl.tagName.toLowerCase();
      const inputEl = htmlEl as HTMLInputElement;

      // Find associated label text if available
      let labelText = '';
      if (inputEl.id) {
        const label = document.querySelector(`label[for="${inputEl.id}"]`);
        if (label) {
          labelText = (label as HTMLElement).innerText.trim();
        }
      }
      if (!labelText && htmlEl.closest('label')) {
        labelText = (htmlEl.closest('label') as HTMLElement).innerText.trim();
      }

      const entry: any = {
        ref: currentRef,
        tagName,
      };

      if (htmlEl.hasAttribute('disabled')) {
        entry.disabled = true;
      }

      if (inputEl.type) entry.type = inputEl.type;
      if (labelText) entry.label = labelText;
      if (inputEl.name) entry.name = inputEl.name;
      if (inputEl.placeholder) entry.placeholder = inputEl.placeholder;

      // Capture current input value so agent knows what is already filled
      if (['input', 'textarea'].includes(tagName)) {
        entry.value = inputEl.value || '';
        if (inputEl.type === 'checkbox' || inputEl.type === 'radio') {
          entry.value = inputEl.checked ? 'checked' : 'unchecked';
        } else if (inputEl.type === 'password' && entry.value) {
          entry.value = '[hidden]';
        }
      } else if (tagName === 'select') {
        const selectEl = htmlEl as HTMLSelectElement;
        entry.value = selectEl.value || '';
        entry.options = Array.from(selectEl.options).map(o => o.text.trim());
      }

      // Capture button / link text
      const innerText = htmlEl.innerText?.trim();
      if (innerText && ['button', 'a'].includes(tagName)) {
        entry.text = innerText.replace(/\s+/g, ' ');
      }

      elements.push(entry);
    }
    
    // Grab visible text for context (e.g. data tables, unformatted amounts)
    const rawBodyText = document.body.innerText.replace(/\s+/g, ' ').trim();
    const visibleText = rawBodyText.substring(0, 1500) + (rawBodyText.length > 1500 ? '...' : '');

    return {
      title: document.title,
      url: window.location.href,
      alerts: alertTexts,
      elements,
      visibleText,
    };
  });

  // Format into a compact string (~150-300 tokens)
  const lines: string[] = [];
  lines.push(`[Page: ${result.title}]`);
  lines.push(`[URL: ${result.url}]`);

  if (result.alerts.length > 0) {
    result.alerts.forEach((alert) => lines.push(`[BANNER]: ${alert}`));
  }

  lines.push('\nInteractive Elements:');
  for (const el of result.elements) {
    const parts: string[] = [`[${el.ref}]`];

    if (el.tagName === 'button' || (el.tagName === 'input' && (el.type === 'submit' || el.type === 'button'))) {
      const btnText = el.text || el.value || 'Button';
      parts.push(`Button "${btnText}"`);
    } else if (el.tagName === 'a') {
      parts.push(`Link "${el.text || 'Link'}"`);
    } else if (el.tagName === 'input' || el.tagName === 'textarea') {
      const fieldDesc = el.label || el.placeholder || el.name || 'Field';
      parts.push(`Input "${fieldDesc}"`);
      if (el.value) {
        parts.push(`(current_value: "${el.value}")`);
      } else {
        parts.push(`(empty)`);
      }
    } else if (el.tagName === 'select') {
      parts.push(`Dropdown "${el.label || el.name || 'Select'}" (selected: "${el.value || ''}")`);
      if (el.options) {
        parts.push(`[options: ${el.options.join(' | ')}]`);
      }
    }

    if (el.disabled) {
      parts.push(`(DISABLED)`);
    }

    lines.push(parts.join(' '));
  }

  if (result.visibleText) {
    lines.push(`\n[Visible Text Context (first 1500 chars)]:\n${result.visibleText}`);
  }

  const formatted = lines.join('\n');

  return {
    title: result.title,
    url: result.url,
    alerts: result.alerts,
    elements: result.elements,
    formatted,
  };
}

// ─── 3. browser_click ────────────────────────────────────────────
export async function browser_click(ref: number): Promise<string> {
  const page = await getActivePage();

  const locator = page.locator(`[data-agent-ref="${ref}"]`);
  const count = await locator.count();

  if (count === 0) {
    throw new Error(
      `Element with ref [${ref}] not found. Call browser_snapshot to get the latest interactive element IDs.`
    );
  }

  // Get description for observation
  const description = await locator.evaluate((el) => {
    const text = (el as HTMLElement).innerText?.trim();
    const tag = el.tagName.toLowerCase();
    const type = (el as HTMLInputElement).type || '';
    return text ? `${tag} "${text}"` : `${tag} [type="${type}"]`;
  });

  // Click element and wait for potential page updates
  await locator.click({ timeout: 5000 });
  await page.waitForTimeout(400);

  const currentUrl = page.url();
  return `Clicked [${ref}] (${description}) → Current page: ${currentUrl}`;
}

// ─── 4. browser_type ─────────────────────────────────────────────
export async function browser_type(ref: number, text: string): Promise<string> {
  const page = await getActivePage();

  const locator = page.locator(`[data-agent-ref="${ref}"]`);
  const count = await locator.count();

  if (count === 0) {
    throw new Error(
      `Element with ref [${ref}] not found. Call browser_snapshot to get the latest interactive element IDs.`
    );
  }

  // Clear existing content and type new value (fill() clears automatically)
  await locator.fill(text, { timeout: 5000 });
  await page.waitForTimeout(100);

  const label = await locator.evaluate((el) => {
    const input = el as HTMLInputElement;
    const lbl = document.querySelector(`label[for="${input.id}"]`);
    return lbl?.textContent?.trim() || input.name || input.placeholder || 'input';
  });

  return `Typed "${text}" into [${ref}] (${label})`;
}

// ─── 5. browser_select ───────────────────────────────────────────
export async function browser_select(ref: number, value: string): Promise<string> {
  const page = await getActivePage();
  const locator = page.locator(`[data-agent-ref="${ref}"]`);
  const count = await locator.count();

  if (count === 0) {
    throw new Error(`Element with ref [${ref}] not found. Call browser_snapshot to get the latest interactive element IDs.`);
  }

  await locator.selectOption(value, { timeout: 5000 });
  await page.waitForTimeout(100);

  const label = await locator.evaluate((el) => {
    const input = el as HTMLSelectElement;
    const lbl = document.querySelector(`label[for="${input.id}"]`);
    return lbl?.textContent?.trim() || input.name || 'dropdown';
  });

  return `Selected "${value}" in [${ref}] (${label})`;
}

// ─── 6. browser_screenshot ───────────────────────────────────────
export async function browser_screenshot(name = 'proof'): Promise<string> {
  const page = await getActivePage();
  const artifactsDir = path.resolve(process.cwd(), 'artifacts');
  const filePath = path.join(artifactsDir, `${name}.png`);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  await page.screenshot({ path: filePath, fullPage: true });
  return filePath;
}


// ─── System Login (Secure Credential Injection) ──────────────
export async function system_login(system: string): Promise<string> {
  const page = await getActivePage();
  const companyName = process.env.COMPANY_NAME;
  if (!companyName) {
    throw new Error('COMPANY_NAME is not set. CLI must pass it.');
  }
  
  const configPath = path.resolve(`companies/${companyName}.config.json`);
  if (!fs.existsSync(configPath)) {
    throw new Error(`Config file not found for ${companyName}: ${configPath}`);
  }
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  const sysConfig = config.systems?.[system.toLowerCase()];
  
  if (!sysConfig) {
    throw new Error(`Unknown system '${system}' in ${companyName} config.`);
  }

  const userVal = process.env[sysConfig.userEnv];
  const passVal = process.env[sysConfig.passEnv];
  if (!userVal || !passVal) {
    throw new Error(`Missing credentials. Ensure ${sysConfig.userEnv} and ${sysConfig.passEnv} are set.`);
  }

  await page.goto(sysConfig.url, { waitUntil: 'domcontentloaded' });
  
  // Simulate realistic typing speed for the demo audience
  await page.waitForTimeout(600);
  await page.fill(sysConfig.userSelector, userVal);
  await page.waitForTimeout(400);
  await page.fill(sysConfig.passSelector, passVal);
  await page.waitForTimeout(600); // Pause so they can see the credentials before clicking

  // Wait for either the error banner OR navigation away from the login page
  const navigationPromise = page.waitForURL(url => url.href !== sysConfig.url, { timeout: 3000 }).catch(() => null);
  await page.click(sysConfig.submitSelector);
  await navigationPromise;
  
  // Add a slight delay on the dashboard
  await page.waitForTimeout(1000);

  // Check if an error banner is displayed or if we are still on the login page
  const errLocator = page.locator(`${sysConfig.errorSelector || '.error-banner'}, .error, .alert, #error-msg, #error-banner`);
  if (await errLocator.count() > 0) {
    const errorMsg = await errLocator.first().innerText();
    if (errorMsg.trim()) {
      throw new Error(`Login failed for ${system}: ${errorMsg.trim()}`);
    }
  }

  const currentParsed = new URL(page.url());
  const configParsed = new URL(sysConfig.url);
  const isLoginPage = currentParsed.pathname === configParsed.pathname || page.url().endsWith('/login');
  if (isLoginPage && (page.url() === sysConfig.url || page.url().includes('error'))) {
    throw new Error(`Login failed for ${system}: Navigation failed (still on login page)`);
  }

  return `System login executed securely for ${system}. Navigation successful.`;
}

// ─── 7. browser_get_text ─────────────────────────────────────────
export async function browser_get_text(ref: number): Promise<string> {
  const page = await getActivePage();
  const locator = page.locator(`[data-agent-ref="${ref}"]`);
  const count = await locator.count();

  if (count === 0) {
    throw new Error(`Element with ref [${ref}] not found.`);
  }

  let text = await locator.innerText();
  if (text.length > 2000) {
    text = text.substring(0, 2000) + '\n...[truncated]';
  }
  return `Text of [${ref}]:\n${text}`;
}
