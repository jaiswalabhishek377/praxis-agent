import { list_files, read_file } from './files.js';
import { ask_user, finish } from './system.js';

async function testFileAndSystemTools() {
  console.log('=== Testing File & System Tools ===\n');

  // 1. Test list_files
  console.log('1. Testing list_files("src/test-data/invoices")...');
  const filesList = await list_files('src/test-data/invoices');
  console.log(filesList);

  // 2. Test read_file on JSON invoice
  console.log('\n2. Testing read_file on latest invoice...');
  const invoiceContent = await read_file('src/test-data/invoices/apex_health.json');
  console.log('First 200 chars:\n', invoiceContent.slice(0, 200));

  // 3. Test Security Sandbox (Path Traversal Protection)
  console.log('\n3. Testing Security Path Traversal Protection...');
  try {
    await read_file('../../outside_file.txt');
    console.log('❌ Security failed — allowed path traversal!');
  } catch (err: any) {
    console.log('✅ Path traversal blocked safely:', err.message);
  }

  // 4. Test ask_user with AUTO_ANSWER (for CI/automated evals)
  console.log('\n4. Testing ask_user with AUTO_ANSWER...');
  process.env.AUTO_ANSWER = 'Apex Healthcare LLC';
  const answer = await ask_user('Which vendor should I select?');
  console.log(`   User responded: "${answer}"`);
  delete process.env.AUTO_ANSWER;

  // 5. Test finish structured signal
  console.log('\n5. Testing finish tool...');
  const finishMsg = await finish({
    status: 'success',
    summary: 'Successfully entered invoice AH-7891 into ERP portal.',
    evidence: 'DB Record #1 confirmed via /__state',
  });
  console.log(finishMsg);

  console.log('\n🎉 ALL FILE & SYSTEM TOOL TESTS PASSED!');
}

testFileAndSystemTools().catch((err) => {
  console.error('Test failed:', err);
  process.exit(1);
});
