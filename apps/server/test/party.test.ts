import { describe, it, expect, beforeEach } from 'vitest'
import { session } from '../src/session'
import { HandQueue } from '../src/heap'
import {
  TestClient,
  openTopic,
  raiseAndAccept,
  speakAndYield,
  getSessionState,
} from './helpers'

// ─── Reset session between tests ─────────────────────────────────────────────

function resetSession() {
  session.releaseToken()
  session.state = 'idle'
  session.topic = null
  session.pending_user_message = null
  // @ts-expect-error - reset internal state
  session.hand_queue = new HandQueue()
  session.event_log.length = 0
  session.speak_history.length = 0
  session['agent_stats'] = new Map()
}

beforeEach(() => resetSession())

// ─── 1. Session lifecycle ─────────────────────────────────────────────────────

describe('session lifecycle', () => {
  it('starts idle and transitions to active on topic_open', async () => {
    const client = await TestClient.connect()
    const snapshot = await client.waitForType<{ state: string }>('session_snapshot')
    expect(snapshot.state).toBe('idle')

    await openTopic(client, 'test topic')
    const debug = await getSessionState()
    expect(debug.state).toBe('active')
    expect(debug.topic).toBe('test topic')
    client.close()
  })

  it('ignores duplicate topic_open', async () => {
    const client = await TestClient.connect()
    await openTopic(client, 'first topic')

    client.send({
      event_type: 'topic_open', sender_id: 'user_1', sender_role: 'user',
      payload: { topic: 'second topic' },
    } as never)
    await new Promise(r => setTimeout(r, 100))

    const debug = await getSessionState()
    expect(debug.topic).toBe('first topic')
    client.close()
  })

  it('transitions to closing then closed', async () => {
    const client = await TestClient.connect()
    await openTopic(client, 'topic')

    client.send({
      event_type: 'close_request', sender_id: 'user_1', sender_role: 'user',
      payload: {},
    } as never)
    await client.waitForEventType('close_request')

    client.send({
      event_type: 'final_summary', sender_id: 'host_1', sender_role: 'host_agent',
      payload: { conclusion: 'done', actions: ['ship it'] },
    } as never)
    await client.waitForEventType('final_summary')

    const debug = await getSessionState()
    expect(debug.state).toBe('closed')
    client.close()
  })
})

// ─── 2. raise_hand + token dispatch ──────────────────────────────────────────

describe('raise_hand and token dispatch', () => {
  it('accepted immediately when no one is speaking', async () => {
    const client = await TestClient.connect()
    await openTopic(client, 'topic')
    const accepted = await raiseAndAccept(client, 'agent_a')
    expect(accepted.event_type).toBe('hand_accepted')
    expect(accepted.payload.holder).toBe('agent_a')
    expect(typeof accepted.payload.token_id).toBe('string')
    client.close()
  })

  it('rejected with rate_limit after exceeding per_agent limit', async () => {
    const client = await TestClient.connect()
    await openTopic(client, 'topic')

    const reason_codes = ['answer', 'evidence', 'challenge'] as const
    for (let i = 0; i < 3; i++) {
      const accepted = await raiseAndAccept(client, 'agent_a', { reason_code: reason_codes[i] })
      await speakAndYield(client, 'agent_a', accepted.payload.token_id, `speak ${i}`)
    }

    client.send({
      event_type: 'raise_hand', sender_id: 'agent_a', sender_role: 'role_agent',
      payload: { intent: 'one more', priority: 'medium', reason_code: 'risk' },
    } as never)
    const rejected = await client.waitForEventType<{ payload: { reason: string } }>('hand_rejected')
    expect(rejected.payload.reason).toBe('rate_limit')
    client.close()
  })

  it('rejected with no_active_session when session is idle', async () => {
    const client = await TestClient.connect()
    client.send({
      event_type: 'raise_hand', sender_id: 'agent_a', sender_role: 'role_agent',
      payload: { intent: 'hi', priority: 'medium', reason_code: 'answer' },
    } as never)
    const rejected = await client.waitForEventType<{ payload: { reason: string } }>('hand_rejected')
    expect(rejected.payload.reason).toBe('no_active_session')
    client.close()
  })

  it('rejected with session_closing when session is closing', async () => {
    const client = await TestClient.connect()
    await openTopic(client, 'topic')
    client.send({
      event_type: 'close_request', sender_id: 'user_1', sender_role: 'user',
      payload: {},
    } as never)
    await client.waitForEventType('close_request')

    client.send({
      event_type: 'raise_hand', sender_id: 'agent_a', sender_role: 'role_agent',
      payload: { intent: 'too late', priority: 'medium', reason_code: 'answer' },
    } as never)
    const rejected = await client.waitForEventType<{ payload: { reason: string } }>('hand_rejected')
    expect(rejected.payload.reason).toBe('session_closing')
    client.close()
  })
})

// ─── 3. Dedup / merge ────────────────────────────────────────────────────────

describe('raise_hand dedup', () => {
  it('same reason_code: merges into one queue entry, takes higher priority', async () => {
    const client = await TestClient.connect()
    await openTopic(client, 'topic')
    const blocker = await raiseAndAccept(client, 'agent_blocker')

    client.send({
      event_type: 'raise_hand', sender_id: 'agent_a', sender_role: 'role_agent',
      payload: { intent: 'first', priority: 'low', reason_code: 'answer' },
    } as never)
    await client.waitForEventType('raise_hand')

    client.send({
      event_type: 'raise_hand', sender_id: 'agent_a', sender_role: 'role_agent',
      payload: { intent: 'updated', priority: 'high', reason_code: 'answer' },
    } as never)
    await client.waitForEventType('raise_hand')

    const debug = await getSessionState()
    const agentAEntries = debug.queue.filter(e => e.sender_id === 'agent_a')
    expect(agentAEntries).toHaveLength(1)
    expect(agentAEntries[0]!.priority).toBe('high')

    await speakAndYield(client, 'agent_blocker', blocker.payload.token_id)
    client.close()
  })

  it('different reason_code: both entries stay in queue', async () => {
    const client = await TestClient.connect()
    await openTopic(client, 'topic')
    const blocker = await raiseAndAccept(client, 'agent_blocker')

    client.send({
      event_type: 'raise_hand', sender_id: 'agent_a', sender_role: 'role_agent',
      payload: { intent: 'evidence', priority: 'medium', reason_code: 'evidence' },
    } as never)
    await client.waitForEventType('raise_hand')

    client.send({
      event_type: 'raise_hand', sender_id: 'agent_a', sender_role: 'role_agent',
      payload: { intent: 'risk', priority: 'medium', reason_code: 'risk' },
    } as never)
    await client.waitForEventType('raise_hand')

    const debug = await getSessionState()
    const agentAEntries = debug.queue.filter(e => e.sender_id === 'agent_a')
    expect(agentAEntries).toHaveLength(2)

    await speakAndYield(client, 'agent_blocker', blocker.payload.token_id)
    client.close()
  })
})

// ─── 4. speak validation ──────────────────────────────────────────────────────

describe('speak validation', () => {
  it('valid speak is broadcast to all clients', async () => {
    const sender = await TestClient.connect()
    const observer = await TestClient.connect()
    await openTopic(sender, 'topic')

    const accepted = await raiseAndAccept(sender, 'agent_a')
    sender.send({
      event_type: 'speak', sender_id: 'agent_a', sender_role: 'role_agent',
      payload: { token_id: accepted.payload.token_id, text: 'hello world' },
    } as never)

    const spoken = await observer.waitForEventType<{ payload: { text: string } }>('speak')
    expect(spoken.payload.text).toBe('hello world')
    sender.close()
    observer.close()
  })

  it('speak with wrong token_id is silently dropped', async () => {
    const client = await TestClient.connect()
    await openTopic(client, 'topic')
    await raiseAndAccept(client, 'agent_a')

    client.send({
      event_type: 'speak', sender_id: 'agent_a', sender_role: 'role_agent',
      payload: { token_id: 'wrong-token-id', text: 'should be dropped' },
    } as never)

    await new Promise(r => setTimeout(r, 150))
    const received = client.received.filter(
      (m) => (m as Record<string, unknown>)['event_type'] === 'speak'
    )
    expect(received).toHaveLength(0)
    client.close()
  })

  it('speak from non-holder is silently dropped', async () => {
    const client = await TestClient.connect()
    await openTopic(client, 'topic')
    const accepted = await raiseAndAccept(client, 'agent_a')

    client.send({
      event_type: 'speak', sender_id: 'agent_b', sender_role: 'role_agent',
      payload: { token_id: accepted.payload.token_id, text: 'stealing the mic' },
    } as never)

    await new Promise(r => setTimeout(r, 150))
    const received = client.received.filter(
      (m) => (m as Record<string, unknown>)['event_type'] === 'speak'
    )
    expect(received).toHaveLength(0)
    client.close()
  })
})

// ─── 5. token queue ordering ──────────────────────────────────────────────────

describe('token queue ordering', () => {
  it('dispatches next agent after yield', async () => {
    const client = await TestClient.connect()
    await openTopic(client, 'topic')
    const first = await raiseAndAccept(client, 'agent_a')

    client.send({
      event_type: 'raise_hand', sender_id: 'agent_b', sender_role: 'role_agent',
      payload: { intent: 'waiting', priority: 'medium', reason_code: 'answer' },
    } as never)
    await client.waitForEventType('raise_hand')

    await speakAndYield(client, 'agent_a', first.payload.token_id)

    const next = await client.waitFor<{ event_type: string; payload: { holder: string } }>(
      (m) => {
        const msg = m as Record<string, unknown>
        const payload = msg['payload'] as Record<string, unknown> | undefined
        return msg['event_type'] === 'hand_accepted' && payload?.['holder'] === 'agent_b'
      }
    )
    expect(next.payload.holder).toBe('agent_b')
    client.close()
  })

  it('high priority beats medium priority regardless of arrival order', async () => {
    const client = await TestClient.connect()
    await openTopic(client, 'topic')
    const blocker = await raiseAndAccept(client, 'agent_blocker')

    // medium arrives first
    client.send({
      event_type: 'raise_hand', sender_id: 'agent_medium', sender_role: 'role_agent',
      payload: { intent: 'medium', priority: 'medium', reason_code: 'answer' },
    } as never)
    await client.waitForEventType('raise_hand')

    // high arrives second
    client.send({
      event_type: 'raise_hand', sender_id: 'agent_high', sender_role: 'role_agent',
      payload: { intent: 'urgent', priority: 'high', reason_code: 'risk' },
    } as never)
    await client.waitForEventType('raise_hand')

    await speakAndYield(client, 'agent_blocker', blocker.payload.token_id)

    // Wait specifically for agent_high's hand_accepted
    const next = await client.waitFor<{ event_type: string; payload: { holder: string } }>(
      (m) => {
        const msg = m as Record<string, unknown>
        const payload = msg['payload'] as Record<string, unknown> | undefined
        return msg['event_type'] === 'hand_accepted' && payload?.['holder'] === 'agent_high'
      }
    )
    expect(next.payload.holder).toBe('agent_high')
    client.close()
  })
})

// ─── 6. user_message interrupt ───────────────────────────────────────────────

describe('user_message interrupt', () => {
  it('soft mode: user message queued, delivered after yield', async () => {
    const client = await TestClient.connect()
    await openTopic(client, 'topic')
    const accepted = await raiseAndAccept(client, 'agent_a')

    client.send({
      event_type: 'user_message', sender_id: 'user_1', sender_role: 'user',
      payload: { text: 'hold on', interrupt_mode: 'soft' },
    } as never)
    await new Promise(r => setTimeout(r, 100))

    const before = client.received.filter(
      (m) => (m as Record<string, unknown>)['event_type'] === 'user_message'
    )
    expect(before).toHaveLength(0)

    client.send({
      event_type: 'yield_token', sender_id: 'agent_a', sender_role: 'role_agent',
      payload: { token_id: accepted.payload.token_id },
    } as never)

    const msg = await client.waitForEventType<{ payload: { text: string } }>('user_message')
    expect(msg.payload.text).toBe('hold on')
    client.close()
  })

  it('hard mode: token revoked immediately, interrupt_granted broadcast', async () => {
    const client = await TestClient.connect()
    await openTopic(client, 'topic')
    await raiseAndAccept(client, 'agent_a')

    client.send({
      event_type: 'user_message', sender_id: 'user_1', sender_role: 'user',
      payload: { text: 'stop now', interrupt_mode: 'hard' },
    } as never)

    await client.waitForEventType('interrupt_granted')
    const debug = await getSessionState()
    expect(debug.current_token).toBeNull()
    client.close()
  })
})

// ─── 7. retarget ─────────────────────────────────────────────────────────────

describe('retarget', () => {
  it('boosts target agent score so they get token next', async () => {
    const client = await TestClient.connect()
    await openTopic(client, 'topic')
    const blocker = await raiseAndAccept(client, 'agent_blocker')

    for (const id of ['agent_a', 'agent_b']) {
      client.send({
        event_type: 'raise_hand', sender_id: id, sender_role: 'role_agent',
        payload: { intent: 'hi', priority: 'medium', reason_code: 'answer' },
      } as never)
      await client.waitForEventType('raise_hand')
    }

    client.send({
      event_type: 'retarget', sender_id: 'user_1', sender_role: 'user',
      payload: { agent_id: 'agent_b' },
    } as never)
    await client.waitForEventType('retarget')

    await speakAndYield(client, 'agent_blocker', blocker.payload.token_id)

    // Wait specifically for agent_b's hand_accepted
    const next = await client.waitFor<{ payload: { holder: string } }>(
      (m) => {
        const msg = m as Record<string, unknown>
        const payload = msg['payload'] as Record<string, unknown> | undefined
        return msg['event_type'] === 'hand_accepted' && payload?.['holder'] === 'agent_b'
      }
    )
    expect(next.payload.holder).toBe('agent_b')
    client.close()
  })
})

// ─── 8. Token TTL expiry ──────────────────────────────────────────────────────

describe('token TTL', () => {
  it('token auto-expires and dispatches next agent', async () => {
    // Patch CONFIG via the already-imported session module (same singleton in forks mode)
    const { CONFIG } = await import('../src/session.js')
    const saved = CONFIG.token_ttl_sec;
    (CONFIG as Record<string, unknown>)['token_ttl_sec'] = 1

    const client = await TestClient.connect()
    await openTopic(client, 'topic')
    await raiseAndAccept(client, 'agent_a')   // holds token, never yields

    client.send({
      event_type: 'raise_hand', sender_id: 'agent_b', sender_role: 'role_agent',
      payload: { intent: 'waiting', priority: 'medium', reason_code: 'answer' },
    } as never)
    await client.waitForEventType('raise_hand')

    const next = await client.waitFor<{ payload: { holder: string } }>(
      (m) => {
        const msg = m as Record<string, unknown>
        const payload = msg['payload'] as Record<string, unknown> | undefined
        return msg['event_type'] === 'hand_accepted' && payload?.['holder'] === 'agent_b'
      },
      5000
    )
    expect(next.payload.holder).toBe('agent_b')

      ; (CONFIG as Record<string, unknown>)['token_ttl_sec'] = saved
    client.close()
  }, 8000)
})

// ─── 9. Schema validation ─────────────────────────────────────────────────────

describe('schema validation', () => {
  it('rejects malformed JSON', async () => {
    const client = await TestClient.connect()
    client.sendRaw('not json at all')
    const err = await client.waitForType<{ type: string; message: string }>('error')
    expect(err.message).toBe('invalid JSON')
    client.close()
  })

  it('rejects unknown event_type', async () => {
    const client = await TestClient.connect()
    client.sendRaw(JSON.stringify({
      event_type: 'unknown_event',
      sender_id: 'agent_a',
      sender_role: 'role_agent',
      payload: {},
    }))
    const err = await client.waitForType<{ type: string; message: string }>('error')
    expect(err.message).toBe('schema validation failed')
    client.close()
  })
})
