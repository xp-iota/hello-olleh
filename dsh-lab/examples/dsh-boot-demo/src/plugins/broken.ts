/** broken —— 故意在 apply 里抛错的插件，只服务于 fail-loud 场景。 */
export const name = 'broken-on-purpose'

export function apply(): void {
  throw new Error('broken plugin: deliberate activation failure')
}