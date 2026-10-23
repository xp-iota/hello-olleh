/**
 * boot.ts —— 用官方装配机制启动 dsh-lab 的服务树。
 *
 * 这个文件是旧工程 `runtime/harness.ts`（581 行、手工 new 出 ~20 个服务、自造
 * `MemorySettingsProvider`、自造模块驱动）的替代品：现在只做三件事——
 *
 *   1. 把 `DSH_HOME` 默认指向工程内的 `.dsh-home/`（会话、存储、凭据都落在这里，
 *      工程自带状态，不污染用户目录）；
 *   2. 调用 `@deepseek-ai/dsh-app-boot` 的 `boot()`：它会创建 cordis Context、
 *      挂 Loader，并把 `cordis.yml`（空表）+ `cordis.patch.yml`（全部行）组合成
 *      服务树；
 *   3. 把启动结果（Context + 若干便捷访问器）交给调用方。
 *
 * 为什么不再手写装配：0.2.1 的 `boot()` 已经把"读配置 → 组合 patch 层 → 校验行
 * → 失败即大声报错"做完了，而且行 id、`!!js` 表达式、相对路径插件导入、依赖
 * 注入顺序这些都是配置树的语义，手写只会把它们复述一遍并且更容易漂移。
 *
 * @module dsh-lab/boot
 */
import { Context } from '@deepseek-ai/cordis'
import { boot, loadOverlayPatches } from '@deepseek-ai/dsh-app-boot'
import { existsSync, mkdirSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

/** 工程根目录（本文件在 `<root>/src/boot.ts`）。 */
export const LAB_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** 装配清单路径：根表 + patch 层。 */
export const ROOT_CONFIG = join(LAB_ROOT, 'cordis.yml')
export const PATCH_CONFIG = join(LAB_ROOT, 'cordis.patch.yml')

/**
 * 确保 `TEMP`/`TMP` 指向一个沙箱**能**在下面建临时授权的目录。
 *
 * 为什么需要这一段（真实踩到的坑）：
 *
 *   Windows 沙箱在跑命令前，会 `mkdtempSync(join(tmpdir(), 'dsh-'))` 建一个临时目录，
 *   再给这个目录加一条针对"临时写 SID"的 ACL —— 那次 ACL 写入要求在**父目录**上有
 *   WRITE_DAC/WRITE_OWNER。本机 `TEMP` 被指到 `D:\TEMP`，而当前用户对 `D:\TEMP`
 *   没有这两个权限（owner 是 Administrators），于是沙箱报：
 *
 *       sandbox-local windows-acl temp grant materialization failed and its cleanup also failed
 *
 *   这是环境问题，不是代码问题：任何依赖 `ctx.shell` 的路径都会撞上它。修法有两条——
 *   给 `D:\TEMP` 改权限（动用户的系统设置，不该由示例工程做），或者让本进程用一个
 *   可写的临时根（`%LOCALAPPDATA%\Temp` 是用户自己的，通常可写）。
 *
 *   这里选后者，并且**只在默认临时根不可用时**才改：能写就完全不动环境。
 *
 * 可用 `DSH_LAB_TEMP` 显式指定；设成 `keep` 表示"别碰 TEMP"。
 */
function ensureWritableTemp(): void {
  const override = process.env.DSH_LAB_TEMP?.trim()
  if (override === 'keep') return

  const candidates = override
    ? [resolve(override)]
    : [
        // 默认：沿用系统给的 TEMP（通常等于 %LOCALAPPDATA%\Temp）。
        process.env.TEMP ?? '',
        process.env.TMP ?? '',
        join(process.env.LOCALAPPDATA ?? '', 'Temp'),
        join(process.env.USERPROFILE ?? '', 'AppData', 'Local', 'Temp'),
      ]

  for (const candidate of candidates) {
    if (candidate === '') continue
    if (canHostSandboxTemp(candidate)) {
      // 只有在需要时才覆盖：能被沙箱用的临时根就是好临时根。
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
    // 关键：探针必须**复现沙箱的真实动作**，否则会给出假阳性。
    //
    // 曾经用 icacls 探针，`D:\TEMP` 一路返回 0，看上去可用，但沙箱真正调用
    // AclWriteGrant 时仍然 Win32 EPERM（5）。原因是沙箱那一次
    // SetNamedSecurityInfoW 同时写了 DACL **和完整性标签**（SECURITY_INFORMATION
    // = DACL | LABEL），而 icacls 只碰 DACL。差别就在标签上：`D:\TEMP` 所在卷/
    // 父目录的标签策略让这次写入失败。
    //
    // 所以这里直接调沙箱自己的 API —— 探针和被测对象是同一个实现，
    // 才不会再次出现"探测说能用、实际用不了"。
    const probe = join(dir, `.dsh-lab-probe-${process.pid.toString(36)}-${Date.now().toString(36)}`)
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

/**
 * 用沙箱自己的 ACL 授权实现试写一次。
 *
 * 同步加载：这段逻辑在启动路径上，且必须在使用 `ctx.shell` 之前完成。
 * 该包只在 Windows 上有意义，其他平台直接返回 false（调用方会保留原 TEMP）。
 */
function aclGrantProbe(dir: string): boolean {
  if (process.platform !== 'win32') return false
  try {
    // 同步 require：ESM 里用 createRequire，避免把启动路径变成异步。
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
 * 把 `DSH_HOME` 指向工程内的 `.dsh-home/`。
 *
 * 这里刻意**不**继承外层 shell 的 `DSH_HOME`：本工程是独立实验室，会话、存储、
 * 凭据都应当留在工程目录里，不能写进用户真实的 harness home。确实要共享时用
 * 专门的 `DSH_LAB_HOME`（例如指向临时目录，或指向 `~/.dsh` 做对照实验）。
 *
 * @returns 实际生效的 harness home 绝对路径。
 */
export function ensureLabHome(): string {
  const configured = process.env.DSH_LAB_HOME?.trim()
  const home = configured ? resolve(configured) : join(LAB_ROOT, '.dsh-home')
  process.env.DSH_HOME = home
  if (!existsSync(home)) mkdirSync(home, { recursive: true })
  return home
}

/** 一次启动的产物。 */
export interface Lab {
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
 * @param options.prepare - 在服务树激活前运行的钩子。可以 `ctx.provide()` 注入
 *   启动参数（例如 `CONFIGURED_AGENT_IDENTITIES_KEY`），也可以做一次性配置。
 * @returns 已启动的 Lab。
 * @throws 装配清单不可读、行无法激活、依赖缺失等任何启动期问题（fail loud）。
 */
export async function bootLab(options: {
  prepare?: (ctx: Context) => void | Promise<void>
} = {}): Promise<Lab> {
  ensureWritableTemp()
  const home = ensureLabHome()

  if (!existsSync(ROOT_CONFIG)) throw new Error(`dsh-lab: 缺少根配置 ${ROOT_CONFIG}`)
  if (!existsSync(PATCH_CONFIG)) throw new Error(`dsh-lab: 缺少装配清单 ${PATCH_CONFIG}`)

  // patch 层就是 YAML 顶层数组；loadOverlayPatches 会做结构校验，并把
  // `name: './src/...'` 这类相对路径锚定成本文件同目录的 file:// URL。
  // 注意：这里返回的已经是 `PatchOptions[]`（每条是 `{insert: [...]}` 或
  // `{id, config}`），boot 期望的正是这个扁平列表，不要再套一层数组。
  const patches = loadOverlayPatches('dsh-lab', PATCH_CONFIG)

  const ctx = await boot(
    'dsh-lab',
    ROOT_CONFIG,
    patches,
    options.prepare,
    // 裸包名（'@deepseek-ai/dsh-llm'）从工程 node_modules 解析。
    pathToFileURL(LAB_ROOT + '/').href,
  )

  return {
    ctx,
    home,
    async dispose() {
      // cordis 的释放入口是 fiber：根 fiber 卸载会按注册逆序跑完全部 disposer
      // （flush 会话日志、关 SQLite、停子进程、注销工具）。
      await ctx.fiber.dispose()
    },
  }
}
