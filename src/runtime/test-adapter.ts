import { callModel, RunTracker } from './adapter.js';

async function testHardenedAdapter() {
  console.log('=== Testing Hardened Production LLM Adapter ===\n');

  const tracker = new RunTracker();

  // Test 1: Simple system prompt — schema instructions auto-injected!
  console.log('Test 1: Simple prompt with auto-schema injection...');
  const res1 = await callModel({
    systemPrompt: 'You are CentrAgent. Help automate ERP login.',
    userPrompt: 'Current page: Login form. Ref 1 is Username, Ref 2 is Password, Ref 3 is Sign In button. What is next action?',
    tracker,
  });

  console.log(`✅ Call 1 succeeded (${res1.provider}:${res1.model})`);
  console.log('Action:', res1.data.action);
  console.log('Params:', JSON.stringify(res1.data.params));

  // Test 2: Another call using the same RunTracker
  console.log('\nTest 2: Second call accumulating per-run metrics...');
  const res2 = await callModel({
    systemPrompt: 'You are CentrAgent.',
    userPrompt: 'Invoice file read successfully. Found vendor: Apex Healthcare LLC, amount: $1450. What is next action?',
    tracker,
  });

  console.log(`✅ Call 2 succeeded (${res2.provider}:${res2.model})`);
  console.log('Action:', res2.data.action);

  // Check per-run metrics from tracker
  console.log('\n=== Per-Run Tracker Summary ===');
  console.log(tracker.getSummary());
}

testHardenedAdapter().catch(console.error);
