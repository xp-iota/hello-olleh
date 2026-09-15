/** 每个 MCP 实例连接一个 server；本教学阶段只走本地进程启动失败的离线边界。 */
export { name, inject, Config, apply } from '@deepseek-ai/dsh-mcp-client'
export type { Config as McpConfig } from '@deepseek-ai/dsh-mcp-client'
