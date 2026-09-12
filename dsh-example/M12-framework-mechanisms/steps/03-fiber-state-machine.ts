/** 未满足 inject 时保持 PENDING；依赖出现后进入 ACTIVE；dispose 后不可复活。 */
import type { Context } from '@deepseek-ai/cordis'

export const name = 'fiber-state-machine-demo'
export const inject = ['lateService']
export function apply(_ctx: Context): void {}
