/**
 * 一个**真实的** MCP stdio server：用官方 @modelcontextprotocol/sdk 实现，
 * 对外暴露一个 mcp_word_count 工具。
 *
 * 它存在的意义是让 M10.2 那个阶段能演示"实际成功的跨进程工具调用"，
 * 而不是只演示"连一个不存在的 server 会怎么失败"。两种结果都要能跑出来：
 *   - 成功：本 server 被拉起 → tools/list 同步到 ctx.tools → tools/call 真的往返一次；
 *   - 拒绝：换成一个不存在的命令 → 启动失败并 fail loud。
 *
 * 全程本机 stdio，不联网、不需要密钥。
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'

const server = new McpServer({ name: 'local-word-count', version: '1.0.0' })

server.registerTool(
  'mcp_word_count',
  {
    title: '统计词数与字符数（跨进程）',
    description: '统计一段文本的单词数与字符数。实现在另一个进程里，通过 MCP 协议调用。',
    inputSchema: { text: z.string().describe('要统计的文本') },
  },
  async ({ text }) => {
    const words = text.trim() ? text.trim().split(/\s+/).length : 0
    return { content: [{ type: 'text', text: `${words} 词 / ${text.length} 字符（来自 MCP server 进程）` }] }
  },
)

await server.connect(new StdioServerTransport())
