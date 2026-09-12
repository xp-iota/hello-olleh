# A3 文件级迁移矩阵（26 → 12）

> 状态：执行契约；基线 `f83469ff PLAN-A2`。A3 只重组 A2 已验证的 26 个示例，不新增 A4 服务缝。

## 结构规则

- 目录层按能力方向收敛为 `M01`–`M12`；模块内仍保持“一种能力一个文件”。
- 旧 `index.ts` 移入 `steps/NN-*.ts`，保持原 Cordis 插件导出；模块 `index.ts` 仅做命名空间聚合，避免 `name/apply/Config` 冲突。
- 旧 `run.ts` 移入 `phases/NN-*.ts`，保留原顶层可执行行为；模块 `run.ts` 以动态 `import()` 顺序执行并打印阶段 banner。
- 真实 provider 路径单独进入 `real/`，由模块 `run-real.ts` 调度，不进入离线 `run-all`。
- 旧 README 的能力点、观察点和文档链接合并进模块 README；不机械拼接全文。
- `runtime/harness.ts` 保持唯一装配枢纽。

## 逐模块映射

| 模块 | 旧示例 | `index.ts` / 能力实现目标 | `run.ts` 目标 | README 归宿 |
|---|---|---|---|---|
| M01 `M01-tool-pipeline` | 01 tool-wordcount | `steps/01-word-count.ts` | `phases/01-register.ts` | M01 §注册与回收 |
|  | 03 permission-gate | `steps/02-permission-gate.ts` | `phases/02-permission-gate.ts` | M01 §pre-execute 权限门 |
|  | 07 tool-result-transform | `steps/03-result-transform.ts` | `phases/03-result-transform.ts` | M01 §post/result 变换 |
|  | 11 tool-restrict | `steps/04-tool-restrict.ts` | `phases/04-tool-restrict.ts` | M01 §可见性收紧 |
|  | 12 tool-guard | `steps/05-tool-guard.ts` | `phases/05-tool-guard.ts` | M01 §单调拒绝 |
| M02 `M02-context-assembly-economics` | 02 prompt-section | `steps/01-prompt-section.ts` | `phases/01-prompt-section.ts` | M02 §段落装配 |
|  | 10 prompt-variable-assemble | `steps/02-prompt-variable-assemble.ts` | `phases/02-prompt-variable-assemble.ts` | M02 §变量与 waterfall |
|  | 14 compaction-provider | `steps/03-compaction-provider.ts` | `phases/03-compaction-provider.ts` | M02 §压缩与 surface replace |
| M03 `M03-inference-service-access` | 05 llm-adapter | `steps/01-llm-adapter.ts` | `phases/01-llm-adapter.ts` | M03 §provider seam 与协议 |
|  | 20 llm-stream | `steps/02-llm-stream.ts` | `phases/02-llm-stream.ts` | M03 §流包装与统计 |
| M04 `M04-agent-loop-intervention` | 06 agent-events-telemetry | `steps/01-agent-events-telemetry.ts` | `phases/01-agent-events-telemetry.ts` | M04 §生命周期观测 |
|  | 09 hooks-lifecycle-steering | `steps/02-lifecycle-steering.ts` | `phases/02-lifecycle-steering.ts` | M04 §轮末引导 |
|  | 19 agent-inbox | `steps/03-agent-inbox.ts` | `phases/03-agent-inbox.ts` | M04 §四通道 inbox |
| M05 `M05-session-surface` | 18 session-log | `steps/01-session-log.ts` | `phases/01-session-log.ts` | M05 全文 |
| M06 `M06-human-in-the-loop` | 04 command-hello | `steps/01-command-hello.ts` | `phases/01-command-hello.ts` | M06 §显式命令入口 |
|  | 13 approval-answerer | `steps/02-approval-answerer.ts` | `phases/02-approval-answerer.ts` | M06 §审批裁决 |
| M07 `M07-execution-backends` | 16 fs-shell-side-effects | `steps/01-fs-shell-side-effects.ts` | `phases/01-fs-shell-side-effects.ts` | M07 §fs/subprocess 与取消 |
|  | 24 shell-service | `steps/02-shell-service.ts` | `phases/02-shell-service.ts` | M07 §shell run/start |
|  | 25 sandbox-seam | `steps/03-sandbox-seam.ts` | `phases/03-sandbox-seam.ts` | M07 §fail-closed 沙箱 |
| M08 `M08-delegation-presets` | 15 subagent-delegation | `steps/01-subagent-delegation.ts` | `phases/01-subagent-delegation.ts` | M08 全文 |
| M09 `M09-long-running-orchestration` | 21 jobs-background | `steps/01-jobs-background.ts` | `phases/01-jobs-background.ts` | M09 §任务生命周期 |
|  | 22 goal-lifecycle | `steps/02-goal-lifecycle.ts` | `phases/02-goal-lifecycle.ts` | M09 §目标日志与 CAS |
| M10 `M10-external-capabilities` | 08 skill-code-review | `steps/01-skill-code-review.ts`（原 `review.ts`） | `phases/01-skill-code-review.ts` | M10 全文 |
| M11 `M11-config-data-infrastructure` | 23 settings-namespaces | `steps/01-settings-namespaces.ts` | `phases/01-settings-namespaces.ts` | M11 全文 |
| M12 `M12-framework-mechanisms` | 17 dispatch-modes | `steps/01-dispatch-modes.ts` | `phases/01-dispatch-modes.ts` | M12 §五种派发模式 |
|  | 26 cordis-timer | `steps/02-cordis-timer.ts` | `phases/02-cordis-timer.ts` | M12 §Fiber 定时器 |

## 特殊文件与真实 provider

| 源文件 | 目标文件 | 处理 |
|---|---|---|
| `01-tool-wordcount/run-minimax.ts` | `M01-tool-pipeline/real/word-count-minimax.ts` | 保留真实模型自主调用工具路径；更新 harness / `.env` 相对路径 |
| `05-llm-adapter/consume.ts` | `M03-inference-service-access/support/consume-stream.ts` | mock/real 共用消费协议检查 |
| `05-llm-adapter/run-minimax.ts` | `M03-inference-service-access/real/llm-adapter-minimax.ts` | 保留真实 provider 协议路径 |
| `08-skill-code-review/SKILL.md` | `M10-external-capabilities/assets/SKILL.md` | 保持数据驱动能力资产原文 |
| `08-skill-code-review/run-minimax.ts` | `M10-external-capabilities/real/skill-code-review-minimax.ts` | 保留注入前后真实模型 A/B 对照 |
| `08-skill-code-review/review.ts` | `M10-external-capabilities/steps/01-skill-code-review.ts` | 更新 SKILL 资产和 harness 相对路径 |

## 根级引用迁移

| 文件 | A3 变更 |
|---|---|
| `package.json` | `01..26` 脚本改为 `M01..M12`；保留 3 条真实 provider 脚本并按模块命名 |
| `runtime/run-all.sh` | 顺序运行 12 个 `M*/run.ts`，离线且 fail-fast |
| `runtime/onboarding.mjs` | 新手路线改用模块 ID、模块入口和 step 源码 |
| `README.md` | 26 行碎片索引改为 12 个方向模块，命令、学习路径和 Skill 资产链接同步 |
| `cordis.yml` | 旧 Skill 目录注释改为 M10 资产路径；其余仅修会悬空的旧路径 |
| `tsconfig.json` | 旧 glob 只覆盖一层目录，改为 `M??-*/**/*.ts` + `runtime/*.ts`，确保 steps/phases/real/support 进入类型门禁 |

## 路径改写规则

- `phases/*` / `real/*`：`../runtime/harness.ts` → `../../runtime/harness.ts`。
- `phases/*`：`./index.ts` → 对应 `../steps/NN-*.ts`。
- M01 result transform 的跨目录依赖改为本模块 `../steps/01-word-count.ts`。
- M03 的 `./consume.ts` → `../support/consume-stream.ts`。
- M10 的 `./review.ts` → `../steps/01-skill-code-review.ts`，能力实现内 `./SKILL.md` → `../assets/SKILL.md`。
- `real/*` 中根 `.env` 路径 `../.env` → `../../.env`。

## A3 可验证出口

1. 旧 26 个目录全部有且仅有一个去向，特殊文件无丢失。
2. `npm run typecheck` 0 错误，`npm test` 7/7。
3. 12 个模块 `run.ts` 全部 exit 0；真实 provider 文件只做类型检查，不在离线全跑中发网请求。
4. 每模块 `run.ts` 有分阶段 banner；每模块 README 独立讲清该方向。
5. `createHarness` 仍只定义于 `runtime/harness.ts`；模块只消费它。
6. 全仓无会导致构建或运行失败的旧示例路径；`git diff --check` 通过。
