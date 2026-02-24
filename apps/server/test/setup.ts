import { beforeAll, afterAll } from 'vitest'
import Fastify, { FastifyRequest } from 'fastify'
import fastifyWebsocket, { WebSocket } from '@fastify/websocket'
import { wsConnectionHandler } from '../src/ws-handler'
import { session } from '../src/session'

// Shared server instance across all test files
let app: ReturnType<typeof Fastify>

beforeAll(async () => {
  app = Fastify()
  await app.register(fastifyWebsocket)
  app.register(async (f: { get: (arg0: string, arg1: { websocket: boolean }, arg2: (socket: WebSocket, _req: FastifyRequest) => void) => void }) => {
    f.get('/party', { websocket: true }, wsConnectionHandler)
  })
  app.get('/debug/session', async () => ({
    state: session.state,
    topic: session.topic,
    current_token: session.current_token
      ? { holder: session.current_token.holder, token_id: session.current_token.token_id, ttl_sec: session.current_token.ttl_sec }
      : null,
    queue: session.hand_queue.toArray().map(e => ({
      sender_id: e.sender_id, priority: e.priority, score: e.score,
    })),
    event_log_length: session.event_log.length,
  }))

  await app.listen({ port: 3001, host: '127.0.0.1' })
})

afterAll(async () => {
  await app.close()
})
