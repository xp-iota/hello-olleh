/**
 * 21 · 后台任务注册表（ctx.jobs）。
 *
 * 对照真实 `@deepseek-ai/dsh-jobs`（抽象 `JobRegistry`，本地后端是 `dsh-jobs-local`）：
 *   - start(spec) 有准入：没有挂接的 job controller 时**拒绝启动**（生产者的活必须有人收/有人停）；
 *   - **JobHooks 拉模型**：spec.run() **同步**返回 { cancel, done, readOutput? }——
 *     cancel(reason) 请求终止（同步、幂等）；done 是 Promise<JobOutcome>（契约上不 reject，
 *     运行期把拒绝转换为 failed）；readOutput() 是拉式增量读，**消费游标归生产者**；
 *   - 注册表颁发 `<kind>-N` id；生命周期 running → stopping → completed | killed | failed；
 *     结算 first-wins，onJobDone 通告放最后；
 *   - read(id) → { text, snapshot }；终态 read 把记录标记为 reported；
 *   - kill(id, caller?, reason?) → 'requested' | 'already-finished'；
 *   - wait(id, timeoutMs, caller?, signal?) 等结算或超时——signal 取消的是等待本身，不取消任务；
 *   - 属主栅栏：JobStart.owner 是 Agent，访问按 ownerSession（会话 id）栅栏；
 *   - `JobKind` 是封闭词表（`'bash' | 'subagent'`），不是自由字符串。
 *
 * 本插件挂接一个 controller（模拟 host 的任务编排层）并把完成事件打出来。
 */
import type { Context } from '@deepseek-ai/cordis'

// 插件名用于 Fiber 诊断；后台任务的实际状态由 ctx.jobs 管理。
// 先注入 jobs，apply 才能挂 controller 和完成回调。
export const name = 'jobs-background'
export const inject = ['jobs']

export function apply(ctx: Context) {
  // 挂接一个 effect 级 controller：start 只向有 controller 服务的属主放行。
  ctx.effect(() => ctx.jobs.attachController('job-controller-demo'))

  ctx.effect(() => ctx.jobs.onJobDone((snapshot, owner) => {
    // onJobDone(snapshot, owner)：snapshot 是只读投影，owner 是精确的 Agent（未 owned 为 undefined）。
    console.log(`  [jobs] 完成通告：${snapshot.id} → ${snapshot.status}${snapshot.detail ? ` (${snapshot.detail})` : ''}${owner ? ` (owner=${owner.id})` : ''}`)
  }))
}
