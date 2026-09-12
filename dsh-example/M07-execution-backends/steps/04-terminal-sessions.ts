/** terminals 是 PTY backend registry；未注册 backend 时以稳定 NO_BACKEND 失败。 */
export { TerminalSessionService as default, TerminalSessionService, TerminalError } from '@deepseek-ai/dsh-terminal'
export * as bashBackend from '@deepseek-ai/dsh-terminal-bash'
