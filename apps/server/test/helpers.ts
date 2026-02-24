import WebSocket from 'ws'
import type { PartyEvent } from '@ai-party/protocol'

export const WS_URL = 'ws://localhost:3001/party'
export const DEBUG_URL = 'http://localhost:3001/debug/session'

// ─── WS client ───────────────────────────────────────────────────────────────

export class TestClient {
  private ws: WebSocket
  private messages: unknown[] = []
  private listeners: Array<(msg: unknown) => void> = []

  private constructor(ws: WebSocket) {
    this.ws = ws
    ws.on('message', (raw) => {
      const msg = JSON.parse(raw.toString())
      this.messages.push(msg)
      this.listeners.forEach(fn => fn(msg))
    })
  }

  static connect(): Promise<TestClient> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(WS_URL)
      ws.once('open', () => resolve(new TestClient(ws)))
      ws.once('error', reject)
    })
  }

  send(partial: Omit<PartyEvent, 'event_id' | 'session_id' | 'timestamp'>): void {
    this.ws.send(JSON.stringify(partial))
  }

  /** Send raw string — for testing schema validation */
  sendRaw(str: string): void {
    this.ws.send(str)
  }

  waitFor<T = unknown>(predicate: (msg: unknown) => boolean, timeout = 3000): Promise<T> {
    return new Promise((resolve, reject) => {
      const idx = this.messages.findIndex(predicate)
      if (idx !== -1) {
        const buffered = this.messages.splice(idx, 1)[0]
        return resolve(buffered as T)
      }

      const timer = setTimeout(() => {
        this.listeners = this.listeners.filter(fn => fn !== handler)
        reject(new Error(`waitFor timed out after ${timeout}ms`))
      }, timeout)

      const handler = (msg: unknown) => {
        if (predicate(msg)) {
          clearTimeout(timer)
          this.listeners = this.listeners.filter(fn => fn !== handler)
          resolve(msg as T)
        }
      }
      this.listeners.push(handler)
    })
  }

  /** Match on `event_type` field (protocol events) */
  waitForEventType<T = unknown>(event_type: string, timeout = 3000): Promise<T> {
    return this.waitFor<T>(
      (m) => (m as Record<string, unknown>)['event_type'] === event_type,
      timeout
    )
  }

  /** Match on `type` field (server meta messages like session_snapshot / error) */
  waitForType<T = unknown>(type: string, timeout = 3000): Promise<T> {
    return this.waitFor<T>(
      (m) => (m as Record<string, unknown>)['type'] === type,
      timeout
    )
  }

  close(): void {
    this.ws.close()
  }

  get received(): unknown[] {
    return [...this.messages]
  }
}

// ─── Session debug ────────────────────────────────────────────────────────────

export async function getSessionState() {
  const res = await fetch(DEBUG_URL)
  return res.json() as Promise<{
    state: string
    topic: string | null
    current_token: { holder: string; token_id: string; ttl_sec: number } | null
    queue: Array<{ sender_id: string; priority: string; score: number }>
    event_log_length: number
  }>
}

// ─── Flow helpers ─────────────────────────────────────────────────────────────

export async function openTopic(client: TestClient, topic: string) {
  client.send({
    event_type: 'topic_open',
    sender_id: 'user_1',
    sender_role: 'user',
    payload: { topic },
  } as PartyEvent)
  return client.waitForEventType('topic_open')
}

export async function raiseAndAccept(
  client: TestClient,
  sender_id: string,
  opts: { priority?: 'high' | 'medium' | 'low'; reason_code?: string } = {}
) {
  client.send({
    event_type: 'raise_hand',
    sender_id,
    sender_role: 'role_agent',
    payload: {
      intent: 'test intent',
      priority: opts.priority ?? 'medium',
      reason_code: opts.reason_code ?? 'answer',
    },
  } as PartyEvent)

  // Wait specifically for THIS agent's hand_accepted
  return client.waitFor<{ event_type: string; payload: { token_id: string; holder: string } }>(
    (m) => {
      const msg = m as Record<string, unknown>
      const payload = msg['payload'] as Record<string, unknown> | undefined
      return msg['event_type'] === 'hand_accepted' && payload?.['holder'] === sender_id
    }
  )
}

export async function speakAndYield(
  client: TestClient,
  sender_id: string,
  token_id: string,
  text = 'hello'
) {
  client.send({
    event_type: 'speak',
    sender_id,
    sender_role: 'role_agent',
    payload: { token_id, text },
  } as PartyEvent)

  // Wait for the speak that carries THIS token_id to avoid matching stale buffered speaks
  await client.waitFor(
    (m) => {
      const msg = m as Record<string, unknown>
      const payload = msg['payload'] as Record<string, unknown> | undefined
      return msg['event_type'] === 'speak' && payload?.['token_id'] === token_id
    }
  )

  client.send({
    event_type: 'yield_token',
    sender_id,
    sender_role: 'role_agent',
    payload: { token_id },
  } as PartyEvent)

  return client.waitFor(
    (m) => {
      const msg = m as Record<string, unknown>
      const payload = msg['payload'] as Record<string, unknown> | undefined
      return msg['event_type'] === 'yield_token' && payload?.['token_id'] === token_id
    }
  )
}
