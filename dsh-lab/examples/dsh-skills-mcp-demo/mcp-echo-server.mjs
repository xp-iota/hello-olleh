/**
 * mcp-echo-server.mjs —— 本工程自带的最小 MCP stdio server（纯 JS，无依赖）。
 *
 * 只实现演示需要的四个方法：initialize / ping / tools/list / tools/call。
 * 协议是 newline-delimited JSON-RPC 2.0：stdout 只写响应，任何日志都不能
 * 走 stdout（会污染协议流）。Node 与 Bun 都能直接跑——patch 里 command
 * 用 process.execPath，当前运行时是什么 server 就用什么。
 */
import { createInterface } from 'node:readline'

const rl = createInterface({ input: process.stdin, terminal: false })
const send = (msg) => process.stdout.write(JSON.stringify(msg) + '\n')

rl.on('line', (line) => {
  if (!line.trim()) return
  let req
  try { req = JSON.parse(line) } catch { return }
  const { id, method, params } = req
  if (method === 'initialize') {
    // 回显客户端请求的协议版本：SDK 校验版本协商，回显最稳。
    send({
      jsonrpc: '2.0', id,
      result: {
        protocolVersion: params?.protocolVersion ?? '2025-06-18',
        capabilities: { tools: {} },
        serverInfo: { name: 'demo-echo', version: '1.0.0' },
      },
    })
  } else if (method === 'ping') {
    send({ jsonrpc: '2.0', id, result: {} })
  } else if (method === 'tools/list') {
    send({
      jsonrpc: '2.0', id,
      result: {
        tools: [{
          name: 'echo',
          description: '把收到的 text 加前缀原样返回（演示 MCP 命名空间）。',
          inputSchema: {
            type: 'object',
            properties: { text: { type: 'string', description: '要回显的文本' } },
            required: ['text'],
          },
        }],
      },
    })
  } else if (method === 'tools/call') {
    const text = params?.arguments?.text ?? ''
    send({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: `echo: ${text}` }] } })
  } else if (id !== undefined) {
    // 通知（无 id，如 notifications/initialized）不需要响应。
    send({ jsonrpc: '2.0', id, error: { code: -32601, message: `method not found: ${method}` } })
  }
})