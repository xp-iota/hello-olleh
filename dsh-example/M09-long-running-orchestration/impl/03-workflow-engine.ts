/** worker-thread Provider 实现 workflowEngine；线程是阻塞隔离，不是安全边界。 */
export { default } from '@deepseek-ai/dsh-workflow-worker-thread'
export type { Config } from '@deepseek-ai/dsh-workflow-worker-thread'
export { WorkflowError, WorkflowRunId } from '@deepseek-ai/dsh-workflow'
