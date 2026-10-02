export {};
const BASE = 'http://localhost:3001';

async function testDate(date: string, expectReject: boolean) {
  const login = await fetch(`${BASE}/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'username=admin&password=admin123',
    redirect: 'manual',
  });
  const cookie = login.headers.get('set-cookie')?.split(';')[0] || '';

  const res = await fetch(`${BASE}/voucher`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: cookie },
    body: `vendor_name=Test&invoice_number=T-1&amount_usd=100&due_date=${encodeURIComponent(date)}`,
    redirect: 'manual',
  });
  const html = await res.text();
  const rejected = html.includes('Validation Error');
  const accepted = html.includes('Successfully');
  const result = rejected ? 'REJECTED' : accepted ? 'ACCEPTED' : 'UNKNOWN';
  const expected = expectReject ? 'REJECTED' : 'ACCEPTED';
  const pass = result === expected;
  console.log(`${pass ? '✅' : '❌'} ${date.padEnd(15)} → ${result} (expected: ${expected})`);
}

async function main() {
  console.log('Testing date validation (CHAOS_VALIDATION=true):\n');
  await testDate('17/31/2027', true);   // invalid month 17
  await testDate('02/30/2026', true);   // Feb 30 doesn't exist
  await testDate('2026-10-15', true);   // wrong format YYYY-MM-DD
  await testDate('hello',      true);   // garbage
  await testDate('10/15/2026', false);  // valid MM/DD/YYYY
  await testDate('11/15/2026', false);  // valid MM/DD/YYYY
  console.log('\nDone!');
}

main().catch(console.error);
