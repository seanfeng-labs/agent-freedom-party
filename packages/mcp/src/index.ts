import { FastMCP } from 'fastmcp'
import { z } from 'zod'
import { AgentClient } from './agent-client'
import type { RaiseHandOptions } from './agent-client.js'
import {
  EventTypeSchema,
  InterruptModeSchema,
  PrioritySchema,
  ReasonCodeSchema,
  SenderRoleSchema,
} from '@ai-party/protocol'
import pkg from '../package.json'

// ─── 多实例管理 ────────────────────────────────────────────────────────────────
const clients = new Map<string, AgentClient>()

function getClient(client_id: string): AgentClient {
  const client = clients.get(client_id)
  if (!client) throw new Error(`client_id "${client_id}" 不存在，请先调用 connect`)
  return client
}

// ─── FastMCP Server ───────────────────────────────────────────────────────────
const server = new FastMCP({
  name: 'ai-party-agent',
  version: pkg.version as `${number}.${number}.${number}`,
  instructions: 'AI Party MCP Server - 连接 AI Party 会话服务器，提供工具调用接口',
})

// ── connect ───────────────────────────────────────────────────────────────────
server.addTool({
  name: 'connect',
  description: '连接到 AI Party 会话服务器，返回 client_id 供后续操作使用',
  parameters: z.object({
    url: z.string().describe('WebSocket 服务器地址，如 ws://localhost:3000/party/:session_id'),
    sender_id: z.string().describe('当前 Agent 的唯一 ID'),
    sender_role: SenderRoleSchema.refine(
      (role) => role !== 'orchestrator',
      { message: 'sender_role 不能为 orchestrator' }
    ).describe('Agent 角色'),
  }),
  execute: async ({ url, sender_id, sender_role }) => {
    const client = await AgentClient.connect({
      url,
      sender_id,
      sender_role,
      onClose: (code, reason) => {
        clients.delete(sender_id)
        console.error(`[${sender_id}] 连接关闭: ${code} ${reason}`)
      },
      onError: (err) => {
        console.error(`[${sender_id}] 错误: ${err.message}`)
      },
    })
    clients.set(sender_id, client)
    return JSON.stringify({ client_id: sender_id, snapshot: client.snapshot })
  },
})

// ── disconnect ────────────────────────────────────────────────────────────────
server.addTool({
  name: 'disconnect',
  description: '断开并销毁指定的连接，client_id 将失效',
  parameters: z.object({
    client_id: z.string().describe('要断开的 client_id'),
  }),
  execute: async ({ client_id }) => {
    getClient(client_id).close()
    clients.delete(client_id)
    return `${client_id} 已断开`
  },
})

// ── get_snapshot ──────────────────────────────────────────────────────────────
server.addTool({
  name: 'get_snapshot',
  description: '获取当前会话快照（state、topic、token 持有人、队列大小等）',
  parameters: z.object({
    client_id: z.string().describe('要获取快照的 client_id'),
  }),
  execute: async ({ client_id }) => {
    const snap = getClient(client_id).snapshot
    return JSON.stringify(snap ?? { error: '暂无 snapshot' })
  },
})

// ── topic_open ────────────────────────────────────────────────────────────────
server.addTool({
  name: 'topic_open',
  description: '开启新议题，必须在会话空闲时调用',
  parameters: z.object({
    client_id: z.string().describe('要操作的 client_id'),
    topic: z.string().describe('议题内容'),
  }),
  execute: async ({ client_id, topic }) => {
    const event = await getClient(client_id).topicOpen(topic)
    return JSON.stringify(event)
  },
})

// ── raise_hand ────────────────────────────────────────────────────────────────
server.addTool({
  name: 'raise_hand',
  description: '举手申请发言 token，返回 accepted/rejected 及 token 信息',
  parameters: z.object({
    client_id: z.string().describe('要操作的 client_id'),
    intent: z.string().describe('发言意图描述'),
    priority: PrioritySchema.describe('优先级'),
    reason_code: ReasonCodeSchema.describe('举手原因代码'),
    reply_to: z.string().optional().describe('回复某条消息的 event_id'),
  }),
  execute: async ({ client_id, intent, priority, reason_code, reply_to }) => {
    const opts: RaiseHandOptions = {
      intent,
      priority: priority as RaiseHandOptions['priority'],
      reason_code: reason_code as RaiseHandOptions['reason_code'],
      ...(reply_to ? { reply_to } : {}),
    }
    const result = await getClient(client_id).raiseHand(opts)
    return JSON.stringify(result)
  },
})

// ── speak ─────────────────────────────────────────────────────────────────────
server.addTool({
  name: 'speak',
  description: '使用持有的 token 发言，仅限 role_agent 角色调用',
  parameters: z.object({
    client_id: z.string().describe('要操作的 client_id'),
    token_id: z.string().describe('要使用的 token_id'),
    text: z.string().describe('发言内容'),
  }),
  execute: async ({ client_id, token_id, text }) => {
    const event = await getClient(client_id).speak(token_id, text)
    return JSON.stringify(event)
  },
})

// ── yield_token ───────────────────────────────────────────────────────────────
server.addTool({
  name: 'yield_token',
  description: '归还当前 token，让出发言权，仅限 role_agent 角色调用',
  parameters: z.object({
    client_id: z.string().describe('要操作的 client_id'),
    token_id: z.string().describe('要归还的 token_id'),
  }),
  execute: async ({ client_id, token_id }) => {
    const event = await getClient(client_id).yieldToken(token_id)
    return JSON.stringify(event)
  },
})

// ── speak_when_ready ──────────────────────────────────────────────────────────
server.addTool({
  name: 'speak_when_ready',
  description: '一键完成：举手 → 发言 → 归还 token，仅限 role_agent 角色调用',
  parameters: z.object({
    client_id: z.string().describe('要操作的 client_id'),
    intent: z.string().describe('发言意图描述'),
    priority: PrioritySchema.describe('优先级'),
    reason_code: ReasonCodeSchema.describe('举手原因代码'),
    reply_to: z.string().optional().describe('回复某条消息的 event_id'),
    text: z.string().describe('发言内容'),
  }),
  execute: async ({ client_id, intent, priority, reason_code, reply_to, text }) => {
    const result = await getClient(client_id).speakWhenReady(
      {
        intent,
        priority: priority as RaiseHandOptions['priority'],
        reason_code: reason_code as RaiseHandOptions['reason_code'],
        ...(reply_to ? { reply_to } : {}),
      },
      () => text,
    )
    return result ? JSON.stringify(result) : '手被拒了，没发成'
  },
})

// ── user_message ──────────────────────────────────────────────────────────────
server.addTool({
  name: 'user_message',
  description: '发送用户消息，仅限 user 角色调用',
  parameters: z.object({
    client_id: z.string().describe('要操作的 client_id'),
    text: z.string().describe('消息内容'),
    interrupt_mode: InterruptModeSchema.default('soft').optional().describe(
      '打断模式，soft 软打断（等待当前发言结束），hard 硬打断（立即切断）'
    ),
  }),
  execute: async ({ client_id, text, interrupt_mode }) => {
    getClient(client_id).userMessage(text, (interrupt_mode ?? 'soft') as any)
    return '已发送'
  },
})

// ── retarget ──────────────────────────────────────────────────────────────────
server.addTool({
  name: 'retarget',
  description: '提升指定 agent 的队列优先级，仅限 user 角色调用',
  parameters: z.object({
    client_id: z.string().describe('要操作的 client_id'),
    agent_id: z.string().describe('要提升优先级的 agent_id'),
  }),
  execute: async ({ client_id, agent_id }) => {
    getClient(client_id).retarget(agent_id)
    return `已 retarget → ${agent_id}`
  },
})

// ── interrupt_request ─────────────────────────────────────────────────────────
server.addTool({
  name: 'interrupt_request',
  description: '申请打断当前发言者，等待 interrupt_granted',
  parameters: z.object({
    client_id: z.string().describe('要操作的 client_id'),
    reason: z.string().describe('打断原因描述'),
    target_token_id: z.string().describe('要打断的目标 token_id'),
  }),
  execute: async ({ client_id, reason, target_token_id }) => {
    const event = await getClient(client_id).interruptRequest(reason, target_token_id)
    return JSON.stringify(event)
  },
})

// ── close_request ─────────────────────────────────────────────────────────────
server.addTool({
  name: 'close_request',
  description: '请求关闭会话，仅限 user 角色调用',
  parameters: z.object({
    client_id: z.string().describe('要操作的 client_id'),
    need: z.string().optional().describe('关闭原因 / 未满足的需求'),
  }),
  execute: async ({ client_id, need }) => {
    getClient(client_id).closeRequest(need)
    return '已发送 close_request'
  },
})

// ── final_summary ─────────────────────────────────────────────────────────────
server.addTool({
  name: 'final_summary',
  description: '发布最终总结并关闭会话，仅限 host_agent 角色调用',
  parameters: z.object({
    client_id: z.string().describe('要操作的 client_id'),
    conclusion: z.string().describe('最终总结内容'),
    actions: z.array(z.string()).describe('已执行的操作列表'),
    divergences: z.array(z.string()).optional().describe('分歧点列表'),
  }),
  execute: async ({ client_id, conclusion, actions, divergences }) => {
    const event = await getClient(client_id).finalSummary(conclusion, actions, divergences)
    return JSON.stringify(event)
  },
})

// ── wait_for ──────────────────────────────────────────────────────────────────
server.addTool({
  name: 'wait_for',
  description: '等待某个事件类型的下一次触发（one-shot），用于调试或流程同步',
  parameters: z.object({
    client_id: z.string().describe('要操作的 client_id'),
    event_type: EventTypeSchema.describe('事件类型'),
    timeout_ms: z.number().default(10_000).optional().describe('超时时间（毫秒）'),
  }),
  execute: async ({ client_id, event_type, timeout_ms }) => {
    const event = await getClient(client_id).waitFor(event_type, timeout_ms ?? 10_000)
    return JSON.stringify(event)
  },
})

// ─── 启动 ─────────────────────────────────────────────────────────────────────
server.start({
  transportType: 'httpStream',
  httpStream: {
    port: Number(process.env.PORT ?? 3001),
    endpoint: '/mcp',
    host: process.env.HOST ?? 'localhost',
  },
})
