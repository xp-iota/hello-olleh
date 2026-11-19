# Cordis `fiber.ts` 完整源码 + 生命周期中文注释
> 推荐按 `constructor → _refresh → _setEpoch → _reload → effect → _updateState → _unload → update/restart` 的顺序阅读，而不是从文件第一行一直看到结尾。

## 一个最容易理解的例子

A 是 `DatabaseProvider`，提供连接池；B、C 通过 `inject` 依赖 A。A 退出 `ACTIVE` 时只通知下游依赖变化，不能立即关连接池；B、C 可能在自己的清理阶段还要使用旧连接。等 B、C 清理自己的 effect 并从 A 的 `dependents` 集合注销后，A 才执行它自己的 effect 回收。对应源码在 `_updateState()`、`_reload()` 和 `_unload()`。

## 完整 TypeScript 源码（无删节）

```typescript
/**
 * ── 先用 30 秒理解 Cordis 生命周期 ──
 *
 * 例子：A（DatabaseProvider）提供数据库服务，B（OrderAgent）和 C（EvaluationAgent）依赖 A。
 *
 * 启动顺序：A 的服务就绪 → B、C 的 inject 解析成功 → B、C 从 PENDING 加载为 ACTIVE。
 * 卸载顺序：A 要退出 ACTIVE → 通知 B、C 依赖变化 → B、C 先卸载并清理自己的资源
 *           → B、C 从 A 的 dependents 中注销 → A 才关闭自己的连接池等资源。
 *
 * 为什么不能 A 先清理？因为 B、C 在 teardown（卸载收尾）中可能还要使用 A 的服务，
 * 比如把最后一批业务数据写入数据库。A 必须在这些使用者完成清理后再回收服务资源。
 *
 * 关键名词速记：
 *   Fiber       = 一次插件挂载的生命周期实例（同一个插件函数可对应多个 Fiber）。
 *   provisions  = 这个 Fiber 提供的服务实现。
 *   dependents  = 某个服务实现当前有哪些使用者 Fiber。
 *   committed   = 本轮启动所绑定的上游服务快照；卸载时据此向上游注销。
 *   effect      = 需随 Fiber 卸载而执行的资源清理注册。
 *   epoch       = 当前想要的运行环境指纹；变动后触发卸载/重载。
 *   inertia     = 当前唯一一条生命周期迁移任务，避免同时启动多次装卸。
 *
 * 最重要的区分：
 *   (1) 插件的父子关系：父 Fiber 的 effect 会触发子 Fiber.dispose()。
 *   (2) 服务的依赖关系：provider 等 consumer 卸载，再清理自己的 effect。
 *   这两种关系可以同时存在，但不是一回事。
 */

/**
 * ============================================================================
 * fiber.ts 完整中文注释版 —— 「一个插件的一生」
 * ============================================================================
 *
 * 来源：deepseek-harness/vendor/cordis/src/fiber.ts（DSH fork 4.1.0，基于上游 rc.11）
 * 本文件是教学副本：代码逻辑与原件逐字一致，只增加中文注释。
 * 原件不可随意改动（见 vendor/README.md 约束）；配套文章见 03-fiber-model.md。
 *
 * ── Java 人的总映射 ─────────────────────────────────────────────────────────
 *   Context        ≈ ApplicationContext（Proxy 包装，extend 出原型链子容器）
 *   Plugin.Runtime ≈ BeanDefinition（按插件函数身份共享一份，registry._internal）
 *   Fiber          ≈ bean 实例 + OSGi Bundle 生命周期 + K8s reconcile 循环
 *   epoch          ≈ 「修订号:依赖A实例id:依赖B实例id」拼成的依赖快照指纹
 *   inertia        ≈ 单飞（single-flight）的状态迁移任务，只追最新目标
 *   effect         ≈ 带自动 close 的资源注册（try-with-resources 的运行时版）
 *
 * ── 一个插件的一生（按本文件中的 【一生·N】 标记阅读）──────────────────────
 *
 *   【一生·1】出生     constructor：领 uid、建子 Context、把 dispose 挂到父 fiber
 *   【一生·2】等待     PENDING：inject 的服务缺席 → epoch=INACTIVE，安静等待
 *   【一生·3】激活     LOADING→ACTIVE：_reload 登记 dependents、执行插件回调
 *   【一生·4】运行     effect 注册的资源（监听器/定时器/服务）随 fiber 存活
 *   【一生·5】重载     依赖换实现/配置更新 → 指纹变 → _unload 再 _reload（原地复活）
 *   【一生·6】卸载     UNLOADING：等依赖者先清理 → 释放自己的 effects → 通知上游 provider
 *   【一生·7】死亡     DISPOSED：uid=null，不可复活；FAILED 是「病」不是「死」
 *
 * ── 全文件最核心的一句话 ────────────────────────────────────────────────────
 *   稳定态由 _getState() 根据 uid/_error/epoch 推导；LOADING/UNLOADING 是显式设置的过渡态。
 *   所有生命周期变化都归结为「epoch 指纹变了 → 单飞迁移追新目标」。
 * ============================================================================
 */
// cosmokit：DSH 自带的工具库（≈ 一个迷你 commons-lang + guava）
import { defineProperty, isNullable } from '@deepseek-ai/cosmokit'
import type { Awaitable, Dict } from '@deepseek-ai/cosmokit'
import { Context } from './context.ts'
import type { Plugin } from './registry.ts'
import { buildOuterStack, composeError, DisposableList, getTraceable, isConstructor, isObject, symbols } from './utils.ts'
import type { Impl } from './reflect.ts'
// standard-schema：跨校验库的统一接口规范（≈ Java 的 Bean Validation / JSR-380）
import type { StandardSchemaV1 } from '@standard-schema/spec'
// TS 模块增强：给 Context 接口补上 fiber 字段和 effect 方法。
// Java 类比：相当于声明「每个 ApplicationContext 都持有一个管理它生命周期的 bean」。
declare module './context.ts' {
  export interface Context extends Pick<Fiber, 'effect'> {
    /** The fiber (plugin runtime instance) that owns this context. */
    fiber: Fiber
  }
}
const kValidationError = Symbol.for('ValidationError')

/**
 * 配置校验失败时抛出的错误。
 * Java 类比：ConstraintViolationException —— 把全部违规项聚合成一条多行消息。
 */
export class ValidationError extends TypeError {
  name = 'ValidationError'

  /**
   * Build the aggregated message from schema issues.
   *
   * @param issues — the standard-schema issues, one message line each.
   */
  constructor(issues: readonly StandardSchemaV1.Issue[]) {
    super(`invalid config:\n` + issues.map(issue => {
      if (issue.path) {
        // 带字段路径的违规：`- 消息 (at a.b.c)`，≈ fieldError.getField()
        return `  - ${issue.message} (at ${issue.path.join('.')})`
      } else {
        return `  - ${issue.message}`
      }
    }).join('\n'))
  }
}
// 打一个跨 realm 可识别的标记（Symbol.for 全局注册表），
// 供别处用 `error[kValidationError]` 判断错误类型，≈ instanceof 的跨包版本。
Object.defineProperty(ValidationError.prototype, kValidationError, {
  value: true,
})

/**
 * 插件启动前的配置校验与规范化。
 * Java 类比：bean 初始化前先跑一遍 Validator.validate(config)，
 * 校验通过则用「规范化后的值」（可能补了默认值、做了类型转换）。
 *
 * @param runtime — the plugin runtime whose `Config` schema to apply.
 * @param config — the raw user config.
 * @returns the validated config, or `config` unchanged if the runtime has no schema.
 * @throws {ValidationError} when validation reports issues.
 */
export function resolveConfig(runtime: Plugin.Runtime, config: any) {
  // 插件没声明 Config schema → 原样放行（≈ 没加 @Valid 就不校验）
  if (!runtime.Config) return config
  // TODO: async validation
  const result = runtime.Config['~standard'].validate(config)
  if ('then' in result) {
    // 目前只支持同步校验；异步 schema 直接拒绝（fail-loud，不静默降级）
    throw new TypeError('Async config validation is not supported')
  }
  if (result.issues) {
    throw new ValidationError(result.issues)
  } else {
    return result.value
  }
}
/** 可 await 的 disposer：既是函数（调用即清理）又是 PromiseLike（可等清理完成）。 */
interface AsyncDisposable<T extends Awaitable<void> = Awaitable<void>> extends PromiseLike<() => T> {
  (): T
}

/**
 * effect 返回的「释放函数」——插件一生中所有资源的回收钩子。
 *
 * Java 类比：AutoCloseable.close()。区别是 cordis 帮你保管：
 * fiber 卸载时按注册的逆序自动调用（后开的资源先关，≈ 栈式 try-with-resources）。
 *
 * Disposers run in reverse registration order when the owning fiber unloads;
 * they may be async, in which case unloading awaits them.
 */
export type Disposable<T = any> = () => T

/**
 * ctx.effect() 与插件启动回调可接受的返回形态，共四种：
 *   1. 单个 disposer 函数          —— () => cleanup
 *   2. Promise<disposer>           —— async () => cleanup
 *   3. 同步生成器 yield 多个        —— function* () { yield close1; yield close2 }
 *   4. 异步生成器 yield 多个        —— async function* () { ... }
 * 生成器形态每 yield 一个就立刻登记一个，中途卸载也能回收已产出的部分。
 */
export type Effect<T = any> =
  | SyncEffect<T>
  | AsyncEffect<T>
type SyncEffect<T = any> =
  | Disposable<T>
  | Iterable<Disposable<T>, void, void>
type AsyncEffect<T = any> =
  | Promise<Disposable<T>>
  | AsyncIterable<Disposable<T>, void, void>
/** effect 的诊断树节点：label 是给人看的名字，children 是嵌套 effect。 */
export interface EffectMeta {
  /** Human-readable effect label, e.g. `ctx.on("event")` or `ctx.provide("name")`. */
  label: string
  /** Metadata of nested effects registered while this effect ran. */
  children: EffectMeta[]
}

/**
 * 「一次可执行任务」的抽象：插件启动本身也是一个 effect，用的是同一个执行器。
 *   epoch         —— 本次执行对应的目标指纹（string 用于插件启动，boolean 用于普通 effect）
 *   execute       —— 真正要跑的函数（插件回调 / effect 体）
 *   collect       —— 收集产出的 disposer
 *   getOuterStack —— 记录调用方栈，报错时能拼出完整因果链
 */
interface EffectRunner<T> {
  epoch: T
execute: () => any
collect: (dispose: Disposable) => void
getOuterStack: () => string[]
}
// 公开 disposer 是单发的（调第二次 no-op），但「结构性持有者」（父 fiber、外层
// effect）需要能加入别人已经启动的清理，等待同一份完成。这张弱键表就是干这个的。
// Public effect disposers remain single-shot, but structural owners and outer
// effects must still be able to join a cleanup that another caller started.
const effectInertia = new WeakMap<Disposable, () => void | Promise<void>>()
function runDisposable(dispose: Disposable) {
  const result = dispose()
  // 若这次清理已在别处进行中，返回那份 in-flight promise 而不是重复执行的结果
  return effectInertia.get(dispose)?.() ?? result
}

/**
 * 广播 internal/plugin（卸载通知），但任何一个观察者抛错都不能打断清理主流程。
 * Java 类比：ApplicationListener 抛异常不应阻止 context.close() —— 逐个 try/catch，
 * 异步回调的 rejection 也兜住只记日志。
 */
function emitPluginDisposed(context: Context, fiber: Fiber) {
  const args: any[] = ['internal/plugin', fiber]
  let callbacks: Function[]
  try {
    callbacks = context.events.dispatch('emit', args)
  } catch (error) {
context.logger.error(error)
    return
  }
  for (const callback of callbacks) {
    try {
      const returned = callback(...args)
      void Promise.resolve(returned).catch(error => context.logger.error(error))
    } catch (error) {
context.logger.error(error)
    }
  }
}

/**
 * 【一生·0】六态定义。注意枚举顺序不等于迁移顺序。
 *
 *   PENDING   等待依赖（不是错误！服务没到齐就安静等）      ≈ bean 等 @DependsOn 就绪
 *   LOADING   插件回调正在执行（过渡态）                    ≈ @PostConstruct 执行中
 *   ACTIVE    已加载、服务已提供                            ≈ bean 就绪可注入
 *   FAILED    回调或配置校验抛错（可经 update() 救活）      ≈ BeanCreationException 但容器还活着
 *   UNLOADING disposer 正在执行（过渡态）                   ≈ @PreDestroy 执行中
 *   DISPOSED  已移除，不可复活                              ≈ bean 销毁、引用作废
 *
 * 关键：PENDING/ACTIVE/FAILED/DISPOSED 四态由 _getState() 推导（见【一生·2】），
 * LOADING/UNLOADING 两个过渡态由迁移回调显式返回（见 _setEpoch）。
 */
export const enum FiberState {
  PENDING,
  LOADING,
  ACTIVE,
  FAILED,
  DISPOSED,
  UNLOADING,
}
/** 带稳定机器可读错误码的框架错误（≈ 带 errorCode 的业务异常基类）。 */
export class CordisError extends Error {

  /**
   * @param code — the stable error code; also the default message.
   * @param message — optional human-readable override.
   */
  constructor(public code: CordisError.Code, message?: string) {
super(message ?? CordisError.Code[code])
  }
}
/** Cordis error code definitions. */
export namespace CordisError {
  export type Code = keyof typeof Code
  export const Code = {
    // 在已销毁/卸载中的 context 上注册 effect → 立刻拒绝，不留僵尸资源
    INACTIVE_EFFECT: 'cannot create effect on inactive context',
  } as const
}
// epoch 的哨兵值：「依赖不齐 / 不该运行」。用字符串而非 null，
// 是为了让 epoch 比较永远是纯字符串相等判断。
const INACTIVE = '__INACTIVE__'

/**
 * ============================================================================
 * Fiber —— 一个插件应用（一次 ctx.plugin() 挂载）的运行时实例。
 * ============================================================================
 *
 * Java 类比总表：
 *   new Fiber(...)        ≈ 容器实例化一个 bean（但先不执行初始化回调）
 *   runtime               ≈ BeanDefinition（同一插件挂 N 行 → N 个 fiber 共享 1 个 runtime）
 *   uid                   ≈ bean 的注册号；null 表示已销毁（引用的「生死牌」）
 *   ctx                   ≈ 这个 bean 专属的子 ApplicationContext
 *   _store                ≈ 依赖快照：服务名 → 当前解析到的实现（Impl）
 *   committed             ≈ 本轮激活时「锁定」的依赖快照（卸载握手要用）
 *   provisions            ≈ 本 fiber 对外提供的服务实现集合
 *   inertia               ≈ 正在跑的装载/卸载任务（单飞）
 *   _revision             ≈ 实现修订号：restart/HMR 替换时 +1，逼出新的 epoch
 *   _disposables          ≈ 本 fiber 名下全部待回收资源的清单
 */
export class Fiber {
  /** registry 内唯一 id；根 fiber 恒为 0；dispose 后变 null（判生死的唯一依据）。 */
  public uid: number | null
  /** 本插件运行所在的 context（parent.extend 出来的原型链子容器）。 */
  public readonly ctx: Context
  /** 原始配置输入，保留给下一次激活用（改配置不一定立刻重启）。 */
  public config: any
  /** 当前生命周期状态；每次变化广播 internal/status。 */
  public state = FiberState.PENDING
  /** 销毁本 fiber：卸载插件，清理完成后 promise 才 settle。 */
  public readonly dispose: () => Promise<void>
  /** 本轮激活锁定的依赖实现集合；依赖者卸载握手期间保持不变。 */
  public committed: Readonly<Dict<Impl>> | undefined
  /** 本 fiber 拥有的服务实现（含 isolate 隔离域内的 provision）。 */
  public readonly provisions: Set<Impl> = new Set()
  /** 正在飞行中的装载/卸载迁移任务；undefined 表示当前稳定。 */
  public inertia: Promise<void> | undefined
  /** 生命周期钩子表（internal/plugin 等事件的挂载点）。 */
  public readonly _hooks: Dict<DisposableList<Function>> = Object.create(null)
  /** 本 Fiber 的顶层 effect disposer 清单；卸载时并行等待，单个 effect 内部按逆序清理。 */
  public readonly _disposables = new DisposableList<Disposable>()
  // 与 this.ctx 同一个对象，只是类型更具体（protected 供子类用）。
  protected context: Context
  private _error: any  // 最近一次启动错误；非空 → FAILED
  private _revision = 0  // 实现修订号；restart()/HMR _replace 时 ++
  private _configRevision = 0  // 配置修订号；update()/rawConfig 赋值时 ++
  private _effectiveConfig: unknown  // 最近一次成功激活/更新实际生效的配置
  private _runner: EffectRunner<string>  // 插件启动执行器（epoch 就是依赖指纹）
  private _store: Dict<Impl> = Object.create(null)  // 依赖快照：名字 → Impl
  private _release: (() => void) | undefined  // 唤醒「等我卸载完」的 provider

  /**
   * 【一生·1】出生：构造一个 fiber。
   * 插件作者通常经 ctx.plugin() 间接走到这里，不直接 new。
   *
   * 出生时做了五件事（对照下面代码块）：
   *   a. 领 uid、extend 出子 Context（≈ 给 bean 建专属子容器）
   *   b. 把 inject 声明里的拦截配置挂到子容器的 intercept 表
   *   c. 组装 _runner：真正执行插件回调的「启动任务」
   *   d. 把「自己的销毁」注册成父 fiber 的一个 effect（父死子必死，自动连带）
   *   e. 广播 internal/plugin 出生通知，然后解析依赖、算第一版 epoch
   *
   * @param parent — the context the plugin was loaded from.
   * @param config — raw config, validated against the runtime's schema.
   * @param inject — resolved dependency map (service name → intercept config).
   * @param runtime — the shared plugin runtime, or `null` for the root fiber.
   * @param getOuterStack — captures the caller stack for effect diagnostics.
   */
  constructor(
    public parent: Context,
config: any,
    public inject: Dict<any>,
    public runtime: Plugin.Runtime | null,
getOuterStack: () => string[],
  ) {
    this.config = config
    // 收集器：插件回调里每次 ctx.effect(...) 产出的 disposer 都进这份清单
    const collect = (dispose: Disposable) => {
      this._disposables.push(dispose)
    }
    if (runtime) {
      // ── 普通插件 fiber ──────────────────────────────────────────────────
      // a. 领注册号；子 Context 以 parent 为原型（原型链继承 ≈ 子容器继承父容器的 bean）
      this.uid = parent.registry.counter
      this.ctx = this.context = parent.extend({ fiber: this })
      // b. inject 不只是「声明依赖」，还可带拦截配置（对注入的服务做包装/代理）。
      //    这里给子容器建一张以父表为原型的 intercept 表，只覆盖自己声明的项。
      const injectEntries = Object.entries(this.inject)
      if (injectEntries.length) {
        this.ctx[Context.intercept] = Object.create(parent[Context.intercept])
        for (const [name, config] of injectEntries) {
          if (isNullable(config)) continue
          this.ctx[Context.intercept][name] = config
        }
      }
      // c. 组装启动执行器。注意：此刻只是「定义怎么启动」，并不执行！
      //    初始 epoch = INACTIVE → 出生即 PENDING，等依赖到齐才真正跑回调。
      this._runner = {
        epoch: INACTIVE,
getOuterStack,
execute: function (this: Fiber) {
          // 激活时才校验配置（≈ bean 初始化前跑 Validator）
          const config = this.resolveConfig(this.config)
          this._effectiveConfig = config
          if (isConstructor(runtime.callback)) {
            // 插件是 class：new 出实例，跑 initHooks，再调 [symbols.init]()
            // ≈ 构造 bean + BeanPostProcessor + @PostConstruct
            // eslint-disable-next-line new-cap
            const instance = new runtime.callback(this.ctx, config)
            for (const hook of instance?.[symbols.initHooks] ?? []) {
              hook()
            }
            return instance?.[symbols.init]?.()
          } else {
            // 插件是函数：直接 apply(ctx, config)，返回值按 Effect 形态收 disposer
            return runtime.callback(this.ctx, config)
          }
        },
collect,
      }
      // d. ★ 关键设计：把「销毁自己」注册成父 fiber 的一个 effect。
      //    于是父插件卸载时，子 fiber 的 dispose 会被自动调用——
      //    插件树的连带销毁不需要任何额外代码，复用 effect 回收机制。
      //    Java 类比：把 child.close() 登记进 parent 的 try-with-resources 清单。
      this.dispose = parent.fiber.effect(() => {
        // 出生即把自己挂进 runtime.fibers（同一 BeanDefinition 的实例列表）
        const remove = runtime.fibers.push(this)
        return async () => {
          // 【一生·7】死亡的第一步：摘掉生死牌。此后 _getState() 恒为 DISPOSED，
          // assertActive() 拒绝一切新 effect。
          this.uid = null
          emitPluginDisposed(this.context, this)
          // 从 runtime 实例列表摘除；最后一个实例走了就删掉整个 runtime
          // （≈ 容器里某类 bean 一个实例都不剩时，连 BeanDefinition 一起清掉）
          if (this.ctx.registry.has(runtime.callback)) {
            remove()
            if (!runtime.fibers.length) {
              this.ctx.registry.delete(runtime.callback)
            }
          }
          // 目标指纹置 INACTIVE → 驱动卸载迁移
          this._setEpoch(INACTIVE)
          // 边界情况：PENDING 的 fiber 也可能已被 internal/plugin 观察者注册了
          // effect。它 epoch 本来就是 INACTIVE，_setEpoch 无迁移可驱动，
          // 所以要显式启动一次 _unload 把这些「激活前的工作」清干净。
          // A PENDING fiber can already own effects registered by an
          // internal/plugin observer. Its epoch is still INACTIVE, so
          // _setEpoch() has no transition to drive; explicitly unload that
          // pre-activation work before reporting disposal complete.
          if (!this.inertia) {
            this._updateState(() => {
              this.inertia = this._unload()
              return FiberState.UNLOADING
            })
          }
          // 等迁移彻底结束（可能 unload→reload→unload 追了几轮）。
          // inertia 本身设计上永不 reject（_reload/_unload 内部吞错记日志）；
          // 若真 reject 只可能是 logger 自己坏了，此处无法自救，让进程崩溃是诚实的结果。
          // `this.inertia` itself should never reject — both `_reload` and
          // `_unload` swallow their own work errors via `ctx.logger.error`.
          // If it does reject, the only remaining cause is the logger
          // itself failing, which we can't recover from in this exact spot
          // (calling the logger again is what just failed). Let the
          // rejection propagate; process-level crash is the honest outcome.
          while (this.inertia) {
            await this.inertia
          }
        }
      }, 'ctx.plugin()')
      try {
        // e. 出生通知。必须等 disposer 完整挂好之后才广播：
        //    同步观察者可能当场 dispose 本 fiber 甚至父 fiber，得先保证能清理。
        // Publish only after the parent owns a fully assigned disposer. A
        // synchronous observer may dispose either this fiber or its parent.
        this.context.emit('internal/plugin', this)
      } catch (error) {
        // 广播本身同步抛错 → 先自我销毁再重抛，不留半挂状态的孤儿
        void Promise.resolve(this.dispose()).catch(reason => this.ctx.logger.error(reason))
        throw error
      }
      // 通知期间 loader 可能扩充 inject，所以依赖解析放在广播之后。
      // 若通知期间已被销毁（uid=null）或父容器正在卸载，则跳过首次激活，
      // 由 disposer 负责清理 PENDING 期的 effect。
      // Keep the initial notification's historical PENDING view. The loader
      // may also extend `inject` in that notification, so resolve dependencies
      // only after publication. A reentrant parent unload makes the child
      // disposer responsible for draining any PENDING effects instead.
      if (this.uid !== null && parent.fiber.state !== FiberState.UNLOADING) {
        for (const name of Object.keys(this.inject)) {
          this._checkImpl(name)  // 逐个解析依赖 → 填 _store
        }
        this._refresh()  // 算第一版 epoch：齐 → LOADING；缺 → 留在 PENDING
      }
    } else {
      // ── 根 fiber（runtime=null）────────────────────────────────────────
      // 根没有插件回调、没有依赖，出生即 ACTIVE，epoch 恒 '0'。
      // 它的 dispose 语义是 restart（清空根上所有插件再重来），不是死亡。
      this.uid = 0
      this.ctx = this.context = parent
      this.state = FiberState.ACTIVE
      this.committed = Object.create(null)
      this._runner = {
        epoch: '0',
getOuterStack,
execute: () => {},
collect,
      }
      this.dispose = () => this.restart()
    }
  }
  /** 显示名：沿父链找最近一个有名字的 runtime，找不到就叫 'root'（日志用）。 */
  get name() {
    let fiber: Fiber = this
    do {
      if (fiber.runtime?.name) return fiber.runtime.name
      fiber = fiber.parent.fiber
    } while (fiber !== fiber.parent.fiber)
    return 'root'
  }

/**
 * 生死检查：uid 已清空（DISPOSED）就抛 INACTIVE_EFFECT。
 * 所有「往 fiber 上挂新东西」的入口都先过这道闸。
 */
assertActive() {
    if (this.uid !== null) return
    throw new CordisError('INACTIVE_EFFECT')
  }

  /**
   * 【一生·4】通用 effect 执行器：跑 execute()，把返回的 disposer 按四种形态收好。
   * 插件启动（_runner）和普通 ctx.effect() 共用这一套 —— 启动本身就是个 effect。
   *
   * composeError 负责把「调用方栈」拼进错误，异步也能追到是谁注册的。
   */
  private _execute<T>(runner: EffectRunner<T>) {
    const oldEpoch = runner.epoch
    return composeError((info) => {
      const safeCollect = (dispose: void | Disposable) => {
        if (typeof dispose === 'function') {
runner.collect(dispose)
        } else if (!isNullable(dispose)) {
          throw new TypeError('Invalid effect')
        }
      }
      const effect: Effect = runner.execute.call(this)
      if (typeof effect === 'function') {
        // 形态 1：直接返回 disposer
        return runner.collect(effect)
      } else if (isNullable(effect)) {
      // 返回 undefined/null：没有要清理的资源，合法（纯副作用插件）
      // return
      } else if (!isObject(effect)) {
        throw new TypeError('Invalid effect')
      } else if ('then' in effect) {
        // 形态 2：Promise<disposer>，等它 resolve 再收
        return effect.then(safeCollect)
      } else if (Symbol.iterator in effect) {
        // 形态 3：同步生成器，逐个 yield 逐个收（先收的先有保障）
        info.error = new Error()
        const iter = effect[Symbol.iterator]()
        while (true) {
          const result = iter.next()
          safeCollect(result.value)
          if (result.done) return
        }
      } else if (Symbol.asyncIterator in effect) {
        // 形态 4：异步生成器。每轮 next 前检查 epoch——
        // 目标已变（fiber 要卸载/重载）就中途停手，不再注册新资源。
        const iter = effect[Symbol.asyncIterator]()
        return (async () => {
          // force async stack trace
          await Promise.resolve()
          info.error = new Error()
          while (true) {
            if (runner.epoch !== oldEpoch) return
            const result = await iter.next()
            safeCollect(result.value)
            if (result.done) return
          }
        })()
      } else {
        throw new TypeError('Invalid effect')
      }
    }, runner.getOuterStack)
  }

  /**
   * 【一生·4】注册一个「带自动回收」的 effect —— 插件运行期资源的唯一入口。
   *
   * 语义：execute 立刻执行；它产出的 disposer 被收好，在
   *   ① 调用返回的 disposer，或 ② fiber 卸载
   * 两者先到时逆序执行。disposer 调两次是 no-op（幂等）。
   *
   * Java 类比：try-with-resources，但资源清单由容器保管、容器关闭时自动倒序 close。
   * ctx.on(...)（事件监听）、ctx.provide(...)（服务提供）、timer 全是它的包装。
   *
   * 下面这一大段的复杂度全部来自并发边界：
   *   - setup 还在跑时就被要求清理（waitForSetup 屏障）
   *   - setup 同步抛错时与持有者卸载赛跑（setupFailed/inFlight）
   *   - 清理已在别处启动，本调用要能「加入」同一份清理（effectInertia）
   *
   * @param execute — the effect body; see {@link Effect} for accepted shapes.
   * @param label — effect label shown in `getEffects()` diagnostics.
   * @returns a disposer that tears the effect down and settles once done.
   */
  effect(execute: () => SyncEffect, label?: string): Disposable<Promise<void>>
  /** Same as above for async effects; the disposer is also awaitable. */
  effect(execute: () => Effect, label?: string): AsyncDisposable<Promise<void>>
  // 【重点：effect 为什么是生命周期管理的核心？】
  // 通过 ctx.effect() 注册的资源，会得到一个 disposer（关闭/解绑/释放函数）。
  // 注册后，disposer 由 Fiber 管理：手动调用可提前清理，Fiber 卸载也会自动调用。
  // 每个 effect 内的子清理按逆序执行；Fiber 顶层 effect 的回收通过 Promise.all 并行等待。
  // 所以不要把“整个 Fiber 的所有 effect 严格依次逆序释放”当成保证。
  effect(execute: () => Effect, label = 'anonymous'): any {
    // 两道闸：已销毁 / 正在卸载的 fiber 不许再挂新资源
    this.assertActive()
    if (this.state === FiberState.UNLOADING) {
      throw new CordisError('INACTIVE_EFFECT')
    }
    // ── 本 effect 私有的 disposer 清单与「清理引擎」──────────────────────
    const disposables: Disposable[] = []
    let disposing = false
    let disposalTask: void | Promise<void>
    const dispose = () => {
      if (disposing) return disposalTask  // 单发：第二次调用返回同一份任务
      disposing = true
      let task!: void | Promise<void>
      // splice(0).reverse()：取空并逆序 —— 后注册的资源先释放（栈式）
      for (const disposable of disposables.splice(0).reverse()) {
        if (task) {
          // 前一个清理是异步的 → 串成链，保证逆序且逐个等待
          task = task.then(() => runDisposable(disposable))
        } else {
          const result = runDisposable(disposable)
          if (isObject(result) && 'then' in result) {
            task = result as any
          }
        }
      }
      return disposalTask = task
    }
    // ── 本 effect 的执行器（epoch 用 boolean：true=活着，false=已清理）────
    const meta: EffectMeta = { label, children: [] }
    const runner: EffectRunner<boolean> = {
      execute,
      epoch: true,
      collect: (dispose) => {
        disposables.push(dispose)
        // 嵌套 effect 的 wrapper 原本挂在 fiber 总清单上；
        // 现在归本 effect 私有清单管（父 effect 清理时连带清理子 effect）
        this._disposables.delete(dispose)
        if (dispose[symbols.effect]) {
          meta.children.push(dispose[symbols.effect])
        }
      },
      getOuterStack: buildOuterStack(),
    }
    let task: void | Promise<void>
    let executing = true
    let resolveSetup: (() => void) | undefined
    let rejectSetup: ((reason: unknown) => void) | undefined
    let setupBarrier: Promise<void> | undefined
    let setupFailed = false
    let inFlight: void | Promise<void>
    let removeWrapper = () => false
    // setup 进行中被要求清理 → 先等 setup 结束（成功或失败）再清
    const waitForSetup = () => {
      setupBarrier ??= new Promise<void>((resolve, reject) => {
        resolveSetup = resolve
        rejectSetup = reject
      })
      return setupBarrier
    }
    // 「等某段 setup 完成后执行 dispose」；setup 失败也要先清理再重抛
    const disposeAfter = (setup: PromiseLike<void>) => {
      return Promise.resolve(setup).then(
        () => dispose(),
        async (reason) => {
          await dispose()
          throw reason
        },
      )
    }
    // 清理收尾：从 fiber 总清单摘掉 wrapper，记录 in-flight 供他人加入
    const finalizeDisposal = (callback: () => void | Promise<void>) => {
      let result: void | Promise<void>
      try {
        result = callback()
      } catch (error) {
        removeWrapper()
        throw error
      }
      if (isObject(result) && 'then' in result) {
        const pending = Promise.resolve(result).finally(() => {
          removeWrapper()
          if (inFlight === pending) inFlight = undefined
        })
        return inFlight = pending
      }
      removeWrapper()
      return result
    }
    // 对外返回的 disposer（wrapper）。runner.epoch=false 后再调是 no-op。
    const wrapper = defineProperty(() => {
      // 同步 setup 失败可能与「持有者卸载」赛跑：对方已拿到 wrapper 但还没调。
      // 失败的 effect 不会公开返回，让内部调用方能 await 到回滚过程。
      // A synchronous setup failure can race an owner unload that already
      // captured this wrapper but has not invoked it yet. The failed effect is
      // never returned publicly, so let that internal caller await rollback.
      if (!runner.epoch) return setupFailed ? inFlight : undefined
      runner.epoch = false
      return finalizeDisposal(() => {
        if (executing) return disposeAfter(waitForSetup())  // setup 还在跑
        return task ? disposeAfter(task) : dispose()  // 等异步 setup / 直接清
      })
    }, symbols.effect, meta) as AsyncDisposable
    // 登记「加入进行中清理」的入口（runDisposable 会查这张表）
    effectInertia.set(wrapper, () => inFlight)
    // ★ 先把 wrapper 挂进 fiber 总清单，再执行 execute()：
    //    插件代码第一行就可能触发重入卸载，届时这个半生 effect 也必须可见、可清。
    // Make the effect visible to a reentrant owner unload before execute()
    // runs any plugin code. Async teardown stays owner-visible until it
    // settles, allowing an outer effect to join cleanup another caller began.
    removeWrapper = this._disposables.push(wrapper)
    try {
      task = this._execute(runner)
    } catch (reason) {
      // setup 同步抛错：标记失败、立即回滚已收集的资源，然后重抛给调用方。
      // 清理若是异步的，兜住 rejection 只记日志（错误本体已经抛出去了）。
      executing = false
      setupFailed = true
      runner.epoch = false
      let cleanup: void | Promise<void>
      try {
        cleanup = finalizeDisposal(dispose)
      } finally {
        rejectSetup?.(reason)
      }
      if (isObject(cleanup) && 'then' in cleanup) {
        cleanup.catch(error => this.ctx.logger.error(error))
      }
      throw reason
    }
    executing = false
    if (setupBarrier) {
      // 有人在 setup 期间等着清理 → 把 setup 的成败通知屏障
      Promise.resolve(task).then(resolveSetup, rejectSetup)
    }
    // 防 unhandled rejection：task 本身失败、以及失败后的清理链再失败，都兜住。
    // prevent unhandled rejection — both from `task` itself and from the
    // disposer chain if it fails to settle cleanly.
    task?.catch(() => {
      if (!runner.epoch) return dispose()
      return finalizeDisposal(dispose)
    }).catch((error) => this.ctx.logger.error(error))
    const disposeAsync = () => {
      if (!runner.epoch) return
      runner.epoch = false
      return finalizeDisposal(dispose)
    }
    // 让 wrapper 可 await：`await ctx.effect(...)` 等 setup 完成，拿到 disposer
    wrapper.then = async (onFulfilled, onRejected) => {
      return Promise.resolve(task)
        .then(() => disposeAsync)
        .then(onFulfilled, onRejected)
    }
    return wrapper
  }
  /** 诊断接口：列出当前活着的 effect 树（demo 里「可逆 effect」场景用它观察）。 */
  getEffects() {
    return [...this._disposables]
      .map<EffectMeta>(dispose => dispose[symbols.effect])
      .filter(Boolean)
  }

  /**
   * 【一生·2】★ 全文件最核心的 5 行：状态是推导出来的，不是存出来的。
   *
   * 三个事实按优先级判定：
   *   uid === null      → DISPOSED（生死牌没了，一票否决）
   *   _error 非空       → FAILED（启动抛过错，等 update() 救治）
   *   epoch ≠ INACTIVE  → ACTIVE（依赖指纹有效 = 就绪）
   *   否则              → PENDING（安静等依赖，不是错误）
   *
   * Java 类比：不写 setStatus()，而是像 K8s 的 status 由 spec+观测实时 reconcile。
   * 「就绪状态须实时判定」——服务缺席时 fiber 停在 PENDING，绝不谎称 ACTIVE。
   */
  // 【重点：状态并不完全等同于 epoch】
  // 下列方法只推导“稳定态”：uid=null -> DISPOSED；有错误 -> FAILED；
  // 指纹有效 -> ACTIVE；其余 -> PENDING。LOADING/UNLOADING 是迁移期间
  // 由 _updateState() 显式返回的“过渡态”，也会保存在 this.state 中。
  private _getState() {
    if (this.uid === null) return FiberState.DISPOSED
    if (this._error) return FiberState.FAILED
    if (this._runner.epoch !== INACTIVE) return FiberState.ACTIVE
    return FiberState.PENDING
  }

  /**
   * 状态迁移的唯一出口：执行回调（可显式返回过渡态），否则用 _getState() 推导，
   * 变了就广播 internal/status；跨越 ACTIVE 边界时还要通知服务层——
   * 本 fiber 提供的每个服务都要 notify 依赖者「供给方状态变了，重算你们的指纹」。
   * （这就是 provider 上下线能自动传导到 consumer 的广播源头。）
   */
  // 【重点：为什么一个服务下线，其他插件会自动感知？】
  // A 从 ACTIVE 变成 UNLOADING，通知并不是直接调用 B._unload()。
  // 而是 A 通过 reflect.notify(...) 宣布「提供的服务状态变了」。
  // B 的依赖解析随后更新 _store / epoch，自己的迁移机制才决定是否卸载。
  // 因此这里是“发布状态变化”，不是“直接清理所有依赖者”。
  private _updateState(callback: () => void | FiberState) {
    const oldState = this.state
    this.state = callback() ?? this._getState()
    if (oldState === this.state) return
    // FIXME internal/fiber-info
    this.context.emit('internal/status', this, oldState)
    // 只在 ACTIVE ↔ 非 ACTIVE 的跨越时通知服务层（PENDING→FAILED 之类不惊动依赖者）
    // only notify changes between ACTIVE and NON-ACTIVE states
    if (oldState !== FiberState.ACTIVE && this.state !== FiberState.ACTIVE) return
    for (const key of Reflect.ownKeys(this.ctx.reflect.store)) {
      const impl = this.ctx.reflect.store[key as symbol]
      if (impl.ctx.fiber !== this) continue
      this.ctx.isolate(impl.name, impl.isolate).reflect.notify([impl.name])
    }
  }

  /**
   * 【一生·2】解析单个依赖：问 reflect 层「服务 name 现在谁提供？」
   *   没人提供 / check() 不通过 / check() 抛错 → 从快照删掉（视为缺席）
   *   否则 → 记入 _store[name]
   * check 是服务自带的健康检查（≈ readiness probe），失败只记日志不算框架错误。
   */
  _checkImpl(name: string) {
    const impl = this.ctx.reflect._getImpl(name, true)
    if (!impl) return delete this._store[name]
    try {
      if (impl.check && !impl.check.call(getTraceable(this.ctx, impl.value))) {
        return delete this._store[name]
      }
    } catch (error) {
      impl.ctx.logger.error(error)
      return delete this._store[name]
    }
    this._store[name] = impl
  }

  /**
   * 【一生·5】★ 依赖指纹（epoch）的计算 —— 整个响应式生命周期的发动机。
   *
   *   epoch = `${_revision}` + 每个依赖的 `:${impl.uid}`
   *   例：修订 0、依赖 database(uid=3)、logger(uid=5) → "0:3:5"
   *
   * 任一依赖缺席 → 整体 INACTIVE（一票否决）。
   * 指纹变了意味着「我运行的世界变了」：依赖换实现、自己 restart、HMR 换芯
   * （_revision++）都会产生新指纹 → _setEpoch 驱动卸载/重载。
   *
   * Java 类比：把「所有 @Autowired 字段的实例 identityHashCode」拼成一个 key，
   * key 变了就自动重建 bean —— Spring 没有这个机制，cordis 的生命周期全靠它。
   */
  // 【重点：epoch 为何能驱动重载？】
  // B 依赖 A，假设 A 的服务 impl.uid=3，B 当前 epoch='0:3'。
  // A 的服务移除 / check 不通过 → B 的 _store 里没有可用实现 → epoch=INACTIVE。
  // A 再提供一个 uid=8 的实现 → epoch='0:8'，B 就知道要按新依赖重新加载。
  // 这不是“状态字符串”，而是“我应该运行在哪一组依赖上”的目标指纹。
  _refresh() {
    let epoch = `${this._revision}`
    for (const name of Object.keys(this.inject)) {
      const impl = this._store[name]
      if (!impl) {
        epoch = INACTIVE
        break
      }
      epoch += ':' + impl.uid
    }
    this._setEpoch(epoch)
  }

  /**
   * 【一生·5】★ 单飞（single-flight）迁移调度 —— K8s reconcile 的迷你版。
   *
   * 三条规则：
   *   1. 指纹没变 → 什么都不做（幂等）
   *   2. FAILED 冻结 → 只有 update() 清掉 _error 后才能再迁移（防错误风暴）
   *   3. 已有迁移在飞 → 只记录新目标（_runner.epoch），不另起任务；
   *      在飞任务收尾时发现目标变了会自动「追」（见 _reload/_unload 尾部）
   *
   * 迁移方向只有两种：
   *   INACTIVE → 有效指纹：_reload（LOADING）
   *   其余任何变化：       _unload（UNLOADING），卸完再看要不要装回来
   *
   * 所以「快速连续换两次 provider」不会执行中间态：第一次卸载还在飞，
   * 第二次变化只改目标，卸载收尾直接朝最终目标 reload —— 原地复活。
   */
  // 【重点：只追最新目标，避免热更新时多个 reload 互相打架】
  // 如果正在卸载，又连续收到两次依赖变化，这里只把目标 epoch 更新到最新。
  // _unload/_reload 结束时会再看最新 epoch；需要的话继续进行下一次迁移。
  // _runner.epoch 代表目标；this.state 记录对外报告的当前状态，两者不能混为一谈。
  private _setEpoch(epoch: string) {
    const oldEpoch = this._runner.epoch
    if (epoch === oldEpoch) return
    // FAILED 只能经 update() 恢复（它会清 _error 并 restart）
    // a failed fiber only recovers through update(), which clears _error
    if (this._error) return
    this._runner.epoch = epoch
    if (this.inertia) return  // ★ 单飞：在飞就只改目标
    this._updateState(() => {
      if (epoch !== INACTIVE && oldEpoch === INACTIVE) {
        this.inertia = this._reload()
        return FiberState.LOADING
      } else {
        this.inertia = this._unload()
        return FiberState.UNLOADING
      }
    })
  }
  /** 原始配置（未求值、未校验），保留给下一次激活。 */
  get rawConfig(): unknown {
    return this.ctx.fiber.config
  }
  /** 只换原始输入，不惊动运行中的实例（loader 持久化新配置时用）。 */
  set rawConfig(config: unknown) {
    this.ctx.fiber.config = config
    this.ctx.fiber._configRevision++
  }

  /**
   * 最近一次成功激活/更新实际生效的配置。
   * 激活前是 undefined；卸载后仍可读（历史值）——要判断「现在活着吗」请看 state。
   */
  get effectiveConfig(): unknown {
    return this.ctx.fiber._effectiveConfig
  }

  /**
   * 求值并校验一份候选配置：走 internal/config waterfall 钩子链 + runtime schema。
   * 只算不发布：不改 raw、不触发重启。≈ 「先 dry-run 一遍 Validator」。
   */
  resolveConfig(config: unknown): unknown {
    const fiber = this.ctx.fiber
    return fiber.context.waterfall('internal/config', fiber, () => config)
  }

  /**
   * 【一生·3】★ 装载迁移：登记依赖握手 → 执行插件回调 → 收尾追目标。
   *
   * 三段结构：
   *   ① committed = 快照锁定：把此刻的 _store 复制一份作为「本轮激活的依赖」。
   *      对每个外部依赖 impl.dependents.add(this) —— 相当于告诉 provider：
   *      「我在用你的服务，你卸载前必须等我先走」。
   *      （Java 类比：销毁连接池前，先等所有持有连接的 bean 释放。）
   *   ② await Promise.resolve() 让出一拍再执行：给同步代码一个改目标的机会；
   *      执行前再核对 epoch，没变才真正跑插件回调。
   *      抛错 → 记日志；若目标没被取代则置 _error（FAILED）并退回 INACTIVE。
   *      若目标已被取代（ superseded ），旧错误不能污染新目标，只清理不定罪。
   *   ③ 收尾：epoch 还是出发时的目标 → 迁移完成（inertia=undefined，状态推导为
   *      ACTIVE 或 FAILED）；目标变了 → 立刻接 _unload 朝新目标追（原地复活）。
   */
  // 【重点：B 为什么会出现在 A 的 dependents 中？】
  // B 加载时先固定本轮所依赖的服务（committed），再执行 dependents.add(B)。
  // 等于告诉 A：“我正在使用你的服务；你退出时必须等我先清理完。”
  // 注意是对每个“上游服务实现 impl”登记，不是随便对插件名字加引用计数。
  private async _reload() {
    this.committed = { ...this._store }
    for (const impl of Object.values(this.committed)) {
      if (impl.ctx.fiber === this) continue  // 自己提供给自己用的不算外部依赖
      impl.dependents.add(this)
    }
    const oldEpoch = this._runner.epoch
    try {
      await Promise.resolve()
      if (this._runner.epoch === oldEpoch) {
        await this._execute(this._runner)  // 真正执行插件回调（apply / new + init）
      }
    } catch (reason) {
      // impl guarantees that the error is non-null (?)
      this.ctx.logger.error(reason)
      // 被取代的装载仍要清理，但不能把失败记到新目标头上
      // A superseded load still needs cleanup, but cannot fail the new target.
      if (this._runner.epoch === oldEpoch) {
        this._error = reason
        this._runner.epoch = INACTIVE
      }
    }
    this._updateState(() => {
      if (this._runner.epoch === oldEpoch) {
        this.inertia = undefined  // 稳定：ACTIVE（或 FAILED）
      } else {
        this.inertia = this._unload()  // 目标变了 → 追！
        return FiberState.UNLOADING
      }
    })
  }

  /**
   * 【一生·6】★ 卸载迁移：等依赖者先走 → 并行等待顶层 effect 清理 → 唤醒上游 provider → 追目标。
   *
   * 四段结构：
   *   ① 握手等待：只要我提供的任一服务还有 dependents，就挂起在 _release  promise 上。
   *      依赖者收到「供给方离开 ACTIVE」的通知后各自卸载，卸完会把我从 dependents
   *      删掉并调我的 _release() 唤醒我。（③ 的镜像动作，两边合成完整握手。）
   *   ② 回收资源：_disposables.clear() 取出全部 wrapper，Promise.all 并发执行；
   *      每个 wrapper 内部自己保证逆序（见 effect() 的 dispose）。
   *      单个 disposer 抛错只记日志，不阻断其他清理 —— 清理必须尽力完成。
   *   ③ 释放上游：从本轮 committed 的每个依赖的 dependents 里删掉自己；
   *      若我是最后一个依赖者 → impl.release() + 唤醒 provider fiber 的 _release。
   *   ④ 收尾追目标：epoch 已是 INACTIVE → 迁移结束（PENDING 或 DISPOSED）；
   *      否则（卸载期间依赖又齐了）→ 接 _reload，LOADING 原地复活。
   */
  // 【重点：Cordis 的依赖感知卸载顺序，按 A -> B -> C 例子看】
  // 假设 A 提供服务，B、C 依赖 A。现在 A 收到停止 / 重启请求：
  //   ① A 退出 ACTIVE，_updateState() 会通知服务依赖关系发生变化。
  //   ② B、C 各自开始 _unload()，但此刻可能还要使用 A 的旧连接池。
  //   ③ 因此 A 在下面的 while 中等待；只要 A 的任一服务仍有 dependents，
  //      A 就不能执行下面的 _disposables.clear() 去销毁数据库连接池。
  //   ④ B、C 先清理它们自己的 effect，然后从各自 committed 服务的 dependents 注销。
  //   ⑤ 最后一位使用者注销后，_release 唤醒 A；A 退出 while、清理自己的 effect。
  //   ⑥ A 如果只是重启（目标 epoch 仍有效）就重新加载；永久 dispose 才不可复活。
  //
  // 请记住：UNLOADING = 本轮运行正在结束；DISPOSED = Fiber 已被永久移除。
  // provider 保留旧资源，不表示它仍对新调用提供 ACTIVE 可用性保证。
  private async _unload() {
    // 依赖者可能在自己的 teardown 里还要访问我的服务，所以必须等它们全部卸完
    // Dependents are notified when this fiber leaves ACTIVE, but may still
    // access its services during their own teardown, so the effects of this
    // fiber are only disposed after every dependent has unloaded.
    while ([...this.provisions].some(impl => impl.dependents.size)) {
      await new Promise<void>((resolve) => this._release = resolve)
    }
    this._release = undefined
    await Promise.all(this._disposables.clear().map(async (dispose) => {
      try {
        await composeError(async (info) => {
          await Promise.resolve()
          info.error = new Error()
          await runDisposable(dispose)
        }, this._runner.getOuterStack)
      } catch (reason) {
        this.ctx.logger.error(reason)
      }
    }))
    // 唤醒正在等我卸载完的 provider 们
    // release the providers waiting for this fiber to unload
    for (const impl of Object.values(this.committed ?? {})) {
      if (!impl.dependents.delete(this) || impl.dependents.size) continue
      impl.release?.()
      impl.ctx.fiber._release?.()
    }
    this.committed = undefined
    this._updateState(() => {
      if (this._runner.epoch === INACTIVE) {
        this.inertia = undefined  // 稳定：PENDING（等依赖）或 DISPOSED
      } else {
        this.inertia = this._reload()  // 依赖又齐了 → 原地复活
        return FiberState.LOADING
      }
    })
  }

  /**
   * 外部观察点：等当前迁移彻底结束（可能追了几轮），有启动错误就重抛。
   * demo 里 `await fiber.await()` 之后打印 state，看到的就是稳定态。
   * Java 类比：Future.get() —— 阻塞到生命周期工作完成，失败原样抛出。
   */
  async await() {
    while (this.inertia) {
      await this.inertia
    }
    if (this._error) throw this._error
    return this
  }

  /**
   * 【一生·5】重启 = 修订号 +1 → 指纹必变 → 卸载再装载（uid 不变！）。
   * HMR 的 fiber._replace 用的正是同一招：_revision++ 然后 _refresh()。
   * 根 fiber 的 dispose 也走这里（清空全部插件重来）。
   */
  async restart() {
    const fiber = this.ctx.fiber
    fiber.assertActive()
    fiber._revision++
    fiber._refresh()
    await fiber.await()
  }

  /**
   * 【一生·5】配置更新 —— FAILED 的唯一救治通道，也是「热更新不重启」的入口。
   *
   * 流程：
   *   ① 已加载 → 先 dry-run 校验候选配置（不合法立刻抛 ValidationError，
   *      运行中的实例毫发无损 —— 和 HMR「先验货再换芯」同一个哲学）
   *   ② 广播 internal/commit（loader 借此持久化）、换 raw、★ 清 _error
   *   ③ 已加载 → 走 internal/update waterfall：监听器可以「就地吸收」新配置
   *      （返回 undefined = 否决重启，插件自己热调整，实例不动）；
   *      未加载（PENDING/FAILED）→ 直接 restart
   *   ④ publish 有四重守卫：没重启过、没被销毁、配置没被更新的 update 覆盖、
   *      epoch 与 committed 都没变 —— 才把候选发布为 effectiveConfig。
   *      （防止并发 update 互相覆盖生效配置。）
   */
  update(config: any, noSave = false): Awaitable<void> {
    const fiber = this.ctx.fiber
    fiber.assertActive()
    const loaded = fiber._runner.epoch !== INACTIVE
    const resolved = loaded ? fiber.resolveConfig(config) : undefined
    if (!noSave) fiber.context.emit('internal/commit', fiber, config)
    fiber.config = config
    fiber._error = undefined  // ★ FAILED 在此解冻
    const configRevision = ++fiber._configRevision
    const epoch = fiber._runner.epoch
    const committed = fiber.committed
    let restarted = false
    const restart = () => {
      restarted = true
      return fiber.restart()
    }
    const publish = () => {
      if (!restarted && fiber.uid !== null && fiber._configRevision === configRevision
        && fiber._runner.epoch === epoch && fiber.committed === committed) {
        fiber._effectiveConfig = resolved
      }
    }
    const result = loaded
      ? fiber.context.waterfall(fiber, 'internal/update', resolved, restart)
      : restart()
    // 监听器否决了重启（就地吸收）→ 没有可等的任务
    // a listener may veto the restart, in which case there is nothing to await
    if (result === undefined) {
      publish()
      return
    }
    const task = Promise.resolve(result).then(publish)
    // 失败已由 fiber 记过日志，这里标记「已处理」：调用方丢掉返回值也不会
    // 变成 unhandled rejection，而 `await update()` 仍能观察到错误。
    // the failure is already reported by the fiber, so mark it handled here:
    // a caller that drops the result cannot turn it into an unhandled
    // rejection, while `await update()` still observes it
    task.catch(() => {})
    return task
  }
}

/**
 * ============================================================================
 * 附：把一生串成一条调用链（对照 02-cordis-fiber-demo 的输出读）
 * ============================================================================
 *
 * ctx.plugin(fn, config)
 *   └─ registry.plugin → new Fiber(...)          【出生】uid 领号、PENDING
 *        └─ _checkImpl × N → _refresh            算指纹："0:3:5" 或 INACTIVE
 *             └─ _setEpoch → _reload             【激活】LOADING
 *                  ├─ committed 锁定 + dependents.add(this)
 *                  ├─ _execute → fn(ctx, config)  插件回调跑起来
 *                  │    └─ ctx.on/provide/timer → effect()  【运行】资源登记
 *                  └─ 收尾：epoch 没变 → ACTIVE
 *
 * provider 换实现 / fiber.update() / HMR _replace
 *   └─ impl.uid 变 或 _revision++ → _refresh     【重载】指纹必变
 *        └─ _setEpoch → _unload                  UNLOADING
 *             ├─ 等 dependents 清空（握手①）
 *             ├─ Promise.all(逆序 disposers)     effect 自动回收
 *             ├─ dependents.delete + 唤醒 provider（握手②）
 *             └─ epoch ≠ INACTIVE → _reload      原地复活，uid 全程不变
 *
 * fiber.dispose()
 *   └─ uid = null → _setEpoch(INACTIVE) → _unload【死亡】
 *        └─ 收尾：epoch = INACTIVE → DISPOSED，assertActive 从此拒绝一切
 *
 * 插件回调抛错
 *   └─ _reload catch → _error = reason           【生病】FAILED（不是死）
 *        └─ update(newConfig) 清 _error → restart 救治
 * ============================================================================
 */

```
