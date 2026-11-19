/**
 * boot.ts —— 用官方装配机制启动本示例的完整服务树。
 *
 * 只做三件事：
 *   1. 把 `DSH_HOME` 默认指向示例内的 `.dsh-home/`（会话、存储、凭据都落在这里，
 *      示例自带状态，不污染用户目录）；
 *   2. 调用 `@deepseek-ai/dsh-app-boot` 的 `boot()`：创建 cordis Context、挂 Loader，
 *      把 `cordis.yml`（空表）+ `cordis.patch.yml`（89 行）组合成服务树；
 *   3. 把启动结果（Context + home + dispose）交给调用方。
 *
 * 为什么不再手写装配：boot() 已经把"读配置 → 组合 patch 层 → 校验行 → 失败即大声
 * 报错"做完了，行 id、!!js 表达式、相对路径插件导入、依赖注入顺序都是配置树的语义，
 * 手写只会把它们复述一遍并且更容易漂移。
 */
import { Context } from '@deepseek-ai/cordis'
import { boot, loadOverlayPatches } from '@deepseek-ai/dsh-app-boot'
import { existsSync, mkdirSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

/** 示例根目录（本文件在 `<root>/src/boot.ts`）。 */
export const DEMO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** 装配清单路径：根表 + patch 层。 */
export const ROOT_CONFIG = join(DEMO_ROOT, 'cordis.yml')
export const PATCH_CONFIG = join(DEMO_ROOT, 'cordis.patch.yml')

/**
 * 确保 `TEMP`/`TMP` 指向一个沙箱**能**在下面建临时授权的目录。
 *
 * 真实踩到的坑：Windows 沙箱跑命令前会 `mkdtempSync(join(tmpdir(), 'dsh-'))`，
 * 再给该目录加一条针对"临时写 SID"的 ACL——那次 ACL 写入要求**父目录**上有
 * WRITE_DAC/WRITE_OWNER。若 TEMP 被指到无此权限的目录（如 D:\TEMP），沙箱报：
 *
 *     sandbox-local windows-acl temp grant materialization failed and its cleanup also failed
 *
 * 修法：让本进程用一个可写的临时根（%LOCALAPPDATA%\Temp 通常可写），
 * 并且**只在默认临时根不可用时**才改。可用 DSH_CHAT_TEMP 显式指定；
 * 设成 keep 表示"别碰 TEMP"。
 */
function ensureWritableTemp(): void {
  const override = process.env.DSH_CHAT_TEMP?.trim()
  if (override === 'keep') return

  const candidates = override
    ? [resolve(override)]
    : [
        process.env.TEMP ?? '',
        process.env.TMP ?? '',
        join(process.env.LOCALAPPDATA ?? '', 'Temp'),
        join(process.env.USERPROFILE ?? '', 'AppData', 'Local', 'Temp'),
      ]

  for (const candidate of candidates) {
    if (candidate === '') continue
    if (canHostSandboxTemp(candidate)) {
      if (candidate !== process.env.TEMP) {
        process.env.TEMP = candidate
        process.env.TMP = candidate
      }
      return
    }
  }
  // 一个都不行：不做假动作，让沙箱自己报错——那时错误信息是有意义的。
}

/** 判断某个目录能否作为沙箱临时根：真跑一次沙箱要做的授权。 */
function canHostSandboxTemp(dir: string): boolean {
  try {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    // 探针必须**复现沙箱的真实动作**：icacls 只碰 DACL，而沙箱那次
    // SetNamedSecurityInfoW 同时写 DACL 和完整性标签，icacls 探针会给假阳性。
    // 所以直接调沙箱自己的 API——探针和被测对象是同一个实现。
    const probe = join(dir, `.dsh-chat-probe-${process.pid.toString(36)}-${Date.now().toString(36)}`)
    mkdirSync(probe, { recursive: true })
    try {
      return aclGrantProbe(probe)
    } finally {
      try {
        rmSync(probe, { recursive: true, force: true })
      } catch {
        // 探针残留不影响判断。
      }
    }
  } catch {
    return false
  }
}

/** 用沙箱自己的 ACL 授权实现试写一次（仅 Windows 有意义）。 */
function aclGrantProbe(dir: string): boolean {
  if (process.platform !== 'win32') return false
  try {
    const require = createRequire(import.meta.url)
    const acl = require('@deepseek-ai/dsh-sandbox-windows-acl') as {
      tempWriteSid: (dir: string) => unknown
      AclWriteGrant: {
        create: (sid: unknown) => { add: (dir: string) => void; dispose: () => void }
      }
    }
    const grant = acl.AclWriteGrant.create(acl.tempWriteSid(dir))
    try {
      grant.add(dir)
      return true
    } finally {
      try {
        grant.dispose()
      } catch {
        // 撤销失败不影响"刚才那次授权成功"这个事实。
      }
    }
  } catch {
    return false
  }
}

/**
 * 把 `DSH_HOME` 指向示例内的 `.dsh-home/`。
 *
 * 刻意**不**继承外层 shell 的 `DSH_HOME`：本示例是独立工程，会话、存储、凭据
 * 都应当留在示例目录里。确实要共享时用 `DSH_CHAT_HOME` 显式指定。
 */
export function ensureDemoHome(): string {
  const configured = process.env.DSH_CHAT_HOME?.trim()
  const home = configured ? resolve(configured) : join(DEMO_ROOT, '.dsh-home')
  process.env.DSH_HOME = home
  if (!existsSync(home)) mkdirSync(home, { recursive: true })
  return home
}

/** 一次启动的产物。 */
export interface ChatDemo {
  /** 装配好的 cordis 根 Context。 */
  readonly ctx: Context
  /** 生效的 harness home。 */
  readonly home: string
  /** 释放整棵树（等价于官方 CLI 的 graceful shutdown）。 */
  dispose(): Promise<void>
}

/**
 * 启动服务树。
 *
 * @param options.prepare - 服务树激活前运行的钩子（可 ctx.provide() 注入启动参数）。
 * @throws 装配清单不可读、行无法激活、依赖缺失等任何启动期问题（fail loud）。
 */
export async function bootChatDemo(options: {
  prepare?: (ctx: Context) => void | Promise<void>
} = {}): Promise<ChatDemo> {
  ensureWritableTemp()
  const home = ensureDemoHome()

  if (!existsSync(ROOT_CONFIG)) throw new Error(`dsh-chat-demo: 缺少根配置 ${ROOT_CONFIG}`)
  if (!existsSync(PATCH_CONFIG)) throw new Error(`dsh-chat-demo: 缺少装配清单 ${PATCH_CONFIG}`)

  // loadOverlayPatches 做结构校验，并把 `name: './src/...'` 相对路径锚定成
  // 本文件同目录的 file:// URL。返回的已是扁平 PatchOptions[]，不要再套数组。
  const patches = loadOverlayPatches('dsh-chat-demo', PATCH_CONFIG)

  const ctx = await boot(
    'dsh-chat-demo',
    ROOT_CONFIG,
    patches,
    options.prepare,
    pathToFileURL(DEMO_ROOT + '/').href,
  )

  return {
    ctx,
    home,
    async dispose() {
      // 根 fiber 卸载按注册逆序跑完全部 disposer（flush 会话日志、关 SQLite、
      // 停子进程、注销工具）。
      await ctx.fiber.dispose()
    },
  }
}