import type { Context } from 'cordis'

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

export const name = 'slow'

export async function apply(ctx: Context) {
  console.log('   [slow] apply 开始')
  await sleep(30)
  ctx.effect(() => async () => {
    console.log('   [slow] 清理开始')
    await sleep(20)
    console.log('   [slow] 清理结束')
  })
  console.log('   [slow] apply 结束')
}