/** webhookRuntime 属于 Host plane；依赖不完整时应保持组合边界，而非伪造服务。 */
export { WebhookRuntime as default, WebhookRuntime, WebhookRuleId, WebhookSourceId } from '@deepseek-ai/dsh-webhook'
