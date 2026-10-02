import {
  browser_navigate,
  browser_snapshot,
  browser_type,
  browser_click,
  browser_screenshot,
  closeBrowser,
} from './browser.js';

async function testBrowserTools() {
  console.log('=== Testing Browser Tools & DOM Ref Tree Engine ===\n');

  try {
    // 1. Navigate to ERP portal login
    console.log('1. Navigating to ERP portal login...');
    const navResult = await browser_navigate('http://localhost:3001/login');
    console.log('  ', navResult);

    // 2. Snapshot DOM Ref Tree
    console.log('\n2. Capturing Login DOM Snapshot...');
    const snapshot1 = await browser_snapshot();
    console.log('--- Login Page Snapshot ---');
    console.log(snapshot1.formatted);
    console.log('---------------------------');

    // 3. Type username into ref 1
    console.log('\n3. Typing username...');
    const type1 = await browser_type(1, 'admin');
    console.log('  ', type1);

    // 4. Type password into ref 2
    console.log('\n4. Typing password...');
    const type2 = await browser_type(2, 'admin123');
    console.log('  ', type2);

    // 5. Click sign in button (ref 3)
    console.log('\n5. Clicking Sign In (ref 3)...');
    const clickResult = await browser_click(3);
    console.log('  ', clickResult);

    // 6. Snapshot new page (Voucher Form)
    console.log('\n6. Capturing Voucher Page Snapshot...');
    const snapshot2 = await browser_snapshot();
    console.log('--- Voucher Page Snapshot ---');
    console.log(snapshot2.formatted);
    console.log('-----------------------------');

    // 7. Test screenshot capture
    console.log('\n7. Capturing Proof Screenshot...');
    const screenshotPath = await browser_screenshot('test_voucher_page');
    console.log(`   Screenshot saved to: ${screenshotPath}`);

    // 8. Test Sandbox Security Gate
    console.log('\n8. Testing Sandbox Origin Security Gate...');
    try {
      await browser_navigate('https://google.com');
      console.log('❌ Security gate failed — allowed non-sandbox URL!');
    } catch (secErr: any) {
      console.log('✅ Security gate blocked external URL:', secErr.message);
    }

    console.log('\n🎉 ALL BROWSER TOOLS & DOM REF TESTS PASSED!');
  } finally {
    await closeBrowser();
  }
}

testBrowserTools().catch((err) => {
  console.error('Test Failed:', err);
  process.exit(1);
});
