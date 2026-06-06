/**
 * simulate-3way.mjs
 *
 * 3-user chat scenario integration test against a running agentroom stack.
 *
 * REST base : http://localhost:3000
 * WS  base  : ws://localhost:3001?token=<JWT>
 *
 * Run with: node simulate-3way.mjs
 * Requires Node 18+ (built-in fetch) and ws package at the path below.
 */

// ---------------------------------------------------------------------------
// WS package — found at apps/ws-server/node_modules/ws
// ---------------------------------------------------------------------------
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const WebSocket = require(
  path.join(__dirname, 'apps/ws-server/node_modules/ws/index.js')
);

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const REST = 'http://localhost:3000';
const WS_BASE = 'ws://localhost:3001';
const TIMEOUT_MS = 2000;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
let stepNum = 0;
let allPassed = true;

function pass(label) {
  stepNum++;
  console.log(`STEP ${stepNum}: PASS — ${label}`);
}

function fail(label, reason) {
  stepNum++;
  allPassed = false;
  console.log(`STEP ${stepNum}: FAIL — ${reason} (${label})`);
}

async function restPost(path, body, token) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`${REST}${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { _raw: text }; }
  return { status: res.status, body: json };
}

/**
 * Open a WebSocket and return a client object with helpers.
 *
 * client.ws           — raw WebSocket
 * client.messages     — all messages received so far
 * client.nextMessage  — Promise<msg> for the next arriving message
 * client.waitFor(pred, timeoutMs) — resolves with first matching msg or rejects
 * client.send(obj)    — JSON.stringify and send
 */
function openWs(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const messages = [];
    let nextResolve = null;

    ws.on('open', () => {
      const client = {
        ws,
        messages,

        send(obj) {
          ws.send(JSON.stringify(obj));
        },

        /**
         * Wait for the next message that satisfies pred within timeoutMs.
         * If pred is undefined, returns the very next message.
         */
        waitFor(pred, timeoutMs = TIMEOUT_MS) {
          return new Promise((res, rej) => {
            // Check already-buffered messages first
            if (pred) {
              const found = messages.find(pred);
              if (found) return res(found);
            }

            let done = false;
            const timer = setTimeout(() => {
              if (!done) {
                done = true;
                rej(new Error(`Timed out after ${timeoutMs}ms waiting for message`));
              }
            }, timeoutMs);

            const handler = (msg) => {
              if (!pred || pred(msg)) {
                if (!done) {
                  done = true;
                  clearTimeout(timer);
                  ws.off('_parsed_message', handler);
                  res(msg);
                }
              }
            };
            ws.on('_parsed_message', handler);
          });
        },
      };

      ws.on('message', (data) => {
        let msg;
        try { msg = JSON.parse(data.toString()); } catch { return; }
        messages.push(msg);
        ws.emit('_parsed_message', msg);
      });

      ws.on('error', (err) => {
        // Silently record; let waitFor timeouts handle failures
      });

      resolve(client);
    });

    ws.on('error', reject);
  });
}

function delay(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// ---------------------------------------------------------------------------
// Main scenario
// ---------------------------------------------------------------------------
async function main() {
  const ts = Date.now();
  const users = {
    alice: { username: `alice_sim_${ts}`, email: `alice_sim_${ts}@test.local`, password: 'Pass1234!' },
    bob:   { username: `bob_sim_${ts}`,   email: `bob_sim_${ts}@test.local`,   password: 'Pass1234!' },
    carol: { username: `carol_sim_${ts}`, email: `carol_sim_${ts}@test.local`, password: 'Pass1234!' },
  };
  const channelName = `sim-test-${ts}`;

  console.log(`\n=== agentroom 3-user simulation (ts=${ts}) ===\n`);

  // -------------------------------------------------------------------------
  // STEP 1: Register 3 users
  // -------------------------------------------------------------------------
  let aliceToken, bobToken, carolToken;
  let aliceId, bobId, carolId;

  try {
    const ra = await restPost('/auth/register', { name: users.alice.username, email: users.alice.email, password: users.alice.password });
    const rb = await restPost('/auth/register', { name: users.bob.username,   email: users.bob.email,   password: users.bob.password });
    const rc = await restPost('/auth/register', { name: users.carol.username, email: users.carol.email, password: users.carol.password });

    if (ra.status !== 201 || !ra.body.accessToken) throw new Error(`Alice register failed: ${JSON.stringify(ra.body)}`);
    if (rb.status !== 201 || !rb.body.accessToken) throw new Error(`Bob register failed: ${JSON.stringify(rb.body)}`);
    if (rc.status !== 201 || !rc.body.accessToken) throw new Error(`Carol register failed: ${JSON.stringify(rc.body)}`);

    aliceToken = ra.body.accessToken;
    bobToken   = rb.body.accessToken;
    carolToken = rc.body.accessToken;
    aliceId    = ra.body.entity.id;
    bobId      = rb.body.entity.id;
    carolId    = rc.body.entity.id;

    pass('Register 3 users (alice, bob, carol)');
  } catch (e) {
    fail('Register 3 users', e.message);
    process.exit(1);
  }

  // -------------------------------------------------------------------------
  // STEP 2: Login all 3 (verify JWTs work — tokens already obtained above)
  // -------------------------------------------------------------------------
  try {
    const la = await restPost('/auth/login', { email: users.alice.email, password: users.alice.password });
    const lb = await restPost('/auth/login', { email: users.bob.email,   password: users.bob.password });
    const lc = await restPost('/auth/login', { email: users.carol.email, password: users.carol.password });

    if (!la.body.accessToken) throw new Error(`Alice login failed: ${JSON.stringify(la.body)}`);
    if (!lb.body.accessToken) throw new Error(`Bob login failed: ${JSON.stringify(lb.body)}`);
    if (!lc.body.accessToken) throw new Error(`Carol login failed: ${JSON.stringify(lc.body)}`);

    // Use fresh login tokens from here on
    aliceToken = la.body.accessToken;
    bobToken   = lb.body.accessToken;
    carolToken = lc.body.accessToken;

    pass('Login all 3 users and obtain JWTs');
  } catch (e) {
    fail('Login all 3 users', e.message);
    process.exit(1);
  }

  // -------------------------------------------------------------------------
  // STEP 3: Alice creates GROUP channel and is auto-added as OWNER
  // -------------------------------------------------------------------------
  let channelId;
  try {
    const res = await restPost('/channels', { type: 'GROUP', name: channelName, isPublic: true }, aliceToken);
    if (res.status !== 201 || !res.body.channel?.id) throw new Error(`Create channel failed: ${JSON.stringify(res.body)}`);
    channelId = res.body.channel.id;
    pass(`Alice creates GROUP channel "${channelName}" (id=${channelId})`);
  } catch (e) {
    fail('Alice creates channel', e.message);
    process.exit(1);
  }

  // -------------------------------------------------------------------------
  // STEP 4: Bob and Carol join via REST POST /channels/:id/members (self-join)
  // -------------------------------------------------------------------------
  try {
    const rb = await restPost(`/channels/${channelId}/members`, { entityId: bobId },   bobToken);
    const rc = await restPost(`/channels/${channelId}/members`, { entityId: carolId }, carolToken);

    if (rb.status !== 201) throw new Error(`Bob join failed (${rb.status}): ${JSON.stringify(rb.body)}`);
    if (rc.status !== 201) throw new Error(`Carol join failed (${rc.status}): ${JSON.stringify(rc.body)}`);

    pass('Bob and Carol join channel via REST self-join');
  } catch (e) {
    fail('Bob/Carol join channel via REST', e.message);
    process.exit(1);
  }

  // -------------------------------------------------------------------------
  // STEP 5: Connect all 3 WebSocket clients
  // -------------------------------------------------------------------------
  let alice, bob, carol;
  try {
    [alice, bob, carol] = await Promise.all([
      openWs(`${WS_BASE}?token=${aliceToken}`),
      openWs(`${WS_BASE}?token=${bobToken}`),
      openWs(`${WS_BASE}?token=${carolToken}`),
    ]);
    pass('Connect all 3 WebSocket clients');
  } catch (e) {
    fail('Connect WebSocket clients', e.message);
    process.exit(1);
  }

  // -------------------------------------------------------------------------
  // STEP 6: Wait for auth confirmation (connect response) on each WS
  // -------------------------------------------------------------------------
  let bobReconnectToken;
  try {
    const [aConn, bConn, cConn] = await Promise.all([
      alice.waitFor(m => m.type === 'response' && m.payload?.action === 'connect' && m.payload?.success === true),
      bob.waitFor(m   => m.type === 'response' && m.payload?.action === 'connect' && m.payload?.success === true),
      carol.waitFor(m => m.type === 'response' && m.payload?.action === 'connect' && m.payload?.success === true),
    ]);

    bobReconnectToken = bConn.payload?.reconnectToken;
    if (!bobReconnectToken) throw new Error('Bob auth response missing reconnectToken');

    pass('Auth confirmation received on all 3 WS connections (reconnectToken captured for Bob)');
  } catch (e) {
    fail('WS auth confirmation', e.message);
    process.exit(1);
  }

  // -------------------------------------------------------------------------
  // STEP 7: All 3 send join action for the channel
  // -------------------------------------------------------------------------
  try {
    const joinMsg = (client) => ({
      id: `j-${Date.now()}`,
      type: 'action',
      from: 'client',
      payload: { action: 'join', channelId },
      ts: new Date().toISOString(),
    });

    alice.send(joinMsg(alice));
    bob.send(joinMsg(bob));
    carol.send(joinMsg(carol));

    await Promise.all([
      alice.waitFor(m => m.type === 'response' && m.payload?.action === 'join' && m.payload?.channelId === channelId && m.payload?.success === true),
      bob.waitFor(m   => m.type === 'response' && m.payload?.action === 'join' && m.payload?.channelId === channelId && m.payload?.success === true),
      carol.waitFor(m => m.type === 'response' && m.payload?.action === 'join' && m.payload?.channelId === channelId && m.payload?.success === true),
    ]);

    pass('All 3 clients send join action and receive join confirmation');
  } catch (e) {
    fail('WS join action', e.message);
    process.exit(1);
  }

  // -------------------------------------------------------------------------
  // STEP 8: Alice sends "hello from alice"
  //         PASS if Bob AND Carol both receive it within 2s
  // -------------------------------------------------------------------------
  try {
    // Drain any buffered signal messages before sending chat
    await delay(100);

    alice.send({
      id: `chat-a1-${Date.now()}`,
      type: 'chat',
      from: 'client',
      channel: channelId,
      payload: { content: 'hello from alice' },
      ts: new Date().toISOString(),
    });

    const isChatFromAlice = (m) =>
      m.type === 'chat' &&
      m.channel === channelId &&
      m.payload?.content === 'hello from alice';

    await Promise.all([
      bob.waitFor(isChatFromAlice),
      carol.waitFor(isChatFromAlice),
    ]);

    pass('Alice sends "hello from alice" — Bob and Carol receive it');
  } catch (e) {
    fail('Alice broadcast to Bob+Carol', e.message);
  }

  // -------------------------------------------------------------------------
  // STEP 9: Bob sends "reply from bob"
  //         PASS if Alice AND Carol both receive it within 2s
  // -------------------------------------------------------------------------
  try {
    bob.send({
      id: `chat-b1-${Date.now()}`,
      type: 'chat',
      from: 'client',
      channel: channelId,
      payload: { content: 'reply from bob' },
      ts: new Date().toISOString(),
    });

    const isChatFromBob = (m) =>
      m.type === 'chat' &&
      m.channel === channelId &&
      m.payload?.content === 'reply from bob';

    await Promise.all([
      alice.waitFor(isChatFromBob),
      carol.waitFor(isChatFromBob),
    ]);

    pass('Bob sends "reply from bob" — Alice and Carol receive it');
  } catch (e) {
    fail('Bob broadcast to Alice+Carol', e.message);
  }

  // -------------------------------------------------------------------------
  // STEP 10: Carol sends leave action for the channel
  // -------------------------------------------------------------------------
  try {
    carol.send({
      id: `leave-c1-${Date.now()}`,
      type: 'action',
      from: 'client',
      payload: { action: 'leave', channelId },
      ts: new Date().toISOString(),
    });

    await carol.waitFor(
      m => m.type === 'response' && m.payload?.action === 'leave' && m.payload?.channelId === channelId && m.payload?.success === true
    );

    pass('Carol sends leave action and receives leave confirmation');
  } catch (e) {
    fail('Carol leave action', e.message);
  }

  // -------------------------------------------------------------------------
  // STEP 11: Alice sends "carol is gone"
  //          PASS if Bob receives it AND Carol does NOT receive it within 2s
  // -------------------------------------------------------------------------
  try {
    // Clear carol's message buffer snapshot length before the send
    const carolMsgCountBefore = carol.messages.length;

    alice.send({
      id: `chat-a2-${Date.now()}`,
      type: 'chat',
      from: 'client',
      channel: channelId,
      payload: { content: 'carol is gone' },
      ts: new Date().toISOString(),
    });

    const isCarolGone = (m) =>
      m.type === 'chat' &&
      m.channel === channelId &&
      m.payload?.content === 'carol is gone';

    // Bob must receive it
    await bob.waitFor(isCarolGone);

    // Carol must NOT receive it within 2s
    let carolGotIt = false;
    try {
      await carol.waitFor(isCarolGone, TIMEOUT_MS);
      carolGotIt = true;
    } catch {
      // Expected timeout — Carol did not receive it
    }

    if (carolGotIt) {
      fail('Alice "carol is gone" — Carol should NOT receive it after leaving', 'Carol received the message after leaving');
    } else {
      pass('Alice sends "carol is gone" — Bob receives it, Carol does NOT');
    }
  } catch (e) {
    fail('Alice "carol is gone" broadcast', e.message);
  }

  // -------------------------------------------------------------------------
  // STEP 12: Carol rejoins; Alice sends "carol is back"
  //          PASS if Carol receives it
  // -------------------------------------------------------------------------
  try {
    // Carol rejoins via WS join action (WS join will re-add membership if needed)
    carol.send({
      id: `j-c2-${Date.now()}`,
      type: 'action',
      from: 'client',
      payload: { action: 'join', channelId },
      ts: new Date().toISOString(),
    });

    await carol.waitFor(
      m => m.type === 'response' && m.payload?.action === 'join' && m.payload?.channelId === channelId && m.payload?.success === true
    );

    // Small buffer for pub/sub subscription to be active
    await delay(100);

    alice.send({
      id: `chat-a3-${Date.now()}`,
      type: 'chat',
      from: 'client',
      channel: channelId,
      payload: { content: 'carol is back' },
      ts: new Date().toISOString(),
    });

    await carol.waitFor(
      m => m.type === 'chat' && m.channel === channelId && m.payload?.content === 'carol is back'
    );

    pass('Carol rejoins and receives "carol is back" from Alice');
  } catch (e) {
    fail('Carol rejoin + receive message', e.message);
  }

  // -------------------------------------------------------------------------
  // STEP 13: Capture Bob's reconnectToken (already captured in step 6)
  //          Verify it is non-empty
  // -------------------------------------------------------------------------
  try {
    if (!bobReconnectToken || typeof bobReconnectToken !== 'string' || bobReconnectToken.length < 10) {
      throw new Error(`Invalid reconnectToken: "${bobReconnectToken}"`);
    }
    pass(`Bob's reconnectToken captured from auth response: ${bobReconnectToken.slice(0, 8)}...`);
  } catch (e) {
    fail('Capture Bob reconnectToken', e.message);
  }

  // -------------------------------------------------------------------------
  // STEP 14: Close Bob's WS connection
  // -------------------------------------------------------------------------
  try {
    await new Promise((resolve) => {
      bob.ws.once('close', resolve);
      bob.ws.close(1000, 'Simulated disconnect');
    });
    pass('Bob WS connection closed cleanly');
  } catch (e) {
    fail('Close Bob WS', e.message);
  }

  // -------------------------------------------------------------------------
  // STEP 15: Reopen Bob's WS with reconnect action
  //          PASS if response includes restoredChannels containing the test channel
  // -------------------------------------------------------------------------
  let bobNew;
  try {
    // Bob opens a fresh WS with his original JWT (token still valid)
    bobNew = await openWs(`${WS_BASE}?token=${bobToken}`);

    // Wait for the new connect response (new session)
    await bobNew.waitFor(
      m => m.type === 'response' && m.payload?.action === 'connect' && m.payload?.success === true
    );

    // Send reconnect action with the stored reconnectToken
    bobNew.send({
      id: `reconnect-b1-${Date.now()}`,
      type: 'action',
      from: 'client',
      payload: { action: 'reconnect', reconnectToken: bobReconnectToken },
      ts: new Date().toISOString(),
    });

    const reconnectResp = await bobNew.waitFor(
      m => m.type === 'response' && m.payload?.action === 'reconnect'
    );

    if (!reconnectResp.payload?.success) {
      throw new Error(`Reconnect failed: ${JSON.stringify(reconnectResp.payload)}`);
    }

    const restoredChannels = reconnectResp.payload?.restoredChannels ?? [];
    if (!restoredChannels.includes(channelId)) {
      throw new Error(`restoredChannels=${JSON.stringify(restoredChannels)} does not include channelId=${channelId}`);
    }

    pass(`Bob reconnects with reconnectToken — restoredChannels includes test channel`);
  } catch (e) {
    fail('Bob reconnect with reconnectToken', e.message);
    // If reconnect failed, use bob's original client for remaining step
    bobNew = bobNew ?? bob;
  }

  // -------------------------------------------------------------------------
  // STEP 16: Alice sends "bob reconnected"
  //          PASS if Bob (new connection) receives it
  // -------------------------------------------------------------------------
  try {
    // Small buffer for subscriptions to be active after reconnect
    await delay(100);

    alice.send({
      id: `chat-a4-${Date.now()}`,
      type: 'chat',
      from: 'client',
      channel: channelId,
      payload: { content: 'bob reconnected' },
      ts: new Date().toISOString(),
    });

    await bobNew.waitFor(
      m => m.type === 'chat' && m.channel === channelId && m.payload?.content === 'bob reconnected'
    );

    pass('Alice sends "bob reconnected" — Bob (reconnected) receives it');
  } catch (e) {
    fail('Alice "bob reconnected" to reconnected Bob', e.message);
  }

  // -------------------------------------------------------------------------
  // Cleanup
  // -------------------------------------------------------------------------
  [alice, bobNew, carol].forEach(c => {
    try { c?.ws?.close(); } catch {}
  });

  // -------------------------------------------------------------------------
  // Summary
  // -------------------------------------------------------------------------
  console.log(`\n=== ${allPassed ? 'ALL STEPS PASSED' : 'SOME STEPS FAILED'} ===\n`);
  process.exit(allPassed ? 0 : 1);
}

main().catch((err) => {
  console.error('Unexpected error:', err);
  process.exit(1);
});
