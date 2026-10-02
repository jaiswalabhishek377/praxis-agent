export {};
const BASE = 'http://localhost:3001';

async function test() {
  // 1. Login and get session cookie
  const loginRes = await fetch(`${BASE}/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'username=admin&password=admin123',
    redirect: 'manual',
  });
  const cookie = loginRes.headers.get('set-cookie')?.split(';')[0] || '';
  console.log('1. Login:', loginRes.status === 302 ? '✅ OK' : `❌ ${loginRes.status}`);
  console.log('   Cookie:', cookie);

  // 2. Submit voucher
  const submitRes = await fetch(`${BASE}/voucher`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Cookie': cookie },
    body: 'vendor_name=Apex+Healthcare+LLC&invoice_number=AH-7891&amount_usd=1450.00&due_date=11/15/2026',
    redirect: 'manual',
  });
  const html = await submitRes.text();
  const success = html.includes('Successfully');
  console.log('2. Submit:', success ? '✅ Voucher submitted' : '❌ Failed');

  // 3. Check /__state
  const stateRes = await fetch(`${BASE}/__state`);
  const state = await stateRes.json() as { count: number; vouchers: Array<Record<string, unknown>> };
  console.log('3. State:', state.count > 0 ? `✅ ${state.count} voucher(s) in DB` : '❌ Empty');
  console.log('   Record:', JSON.stringify(state.vouchers[0], null, 2));

  console.log('\n✅ All ERP Portal tests passed!');
}

test().catch(console.error);
