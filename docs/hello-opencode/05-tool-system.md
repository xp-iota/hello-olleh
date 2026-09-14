---
title: "工具系统：Tool.make 结构契约、Scope 注册与请求快照"
---
# 工具系统：Tool.make 结构契约、Scope 注册与请求快照

> 基于 `sources/opencode/specs/v2/tools.md` 与 `sources/opencode/packages/core/src/tool/` 中的 OpenCode `v2.0.2` 源码校对。

**目录**

- [1. 一个结构契约](#1-一个结构契约)
- [2. 每次调用的 durable 身份](#2-每次调用的-durable-身份)
- [3. Scope 化的注册覆盖](#3-scope-化的注册覆盖)
- [4. 请求快照与执行管线](#4-请求快照与执行管线)
- [5. 输出边界与保留](#5-输出边界与保留)
- [6. 失败语义与法则](#6-失败语义与法则)

---

## 1. 一个结构契约

v2 只有一种本地可执行工具的结构值，公共类型归 `packages/plugin` 拥有，注册、执行与通用输出边界归 Core。`Tool.make` 把输入 schema、可选输出 schema、描述与执行函数绑在一起：

```ts
const read = Tool.make({
  description: "Read a file",
  input: Schema.Struct({ path: Schema.String }),
  output: Schema.Struct({ content: Schema.String }),
  execute: ({ path }, context) =>
    readFile(path, context).pipe(Effect.map((output) => ({ output, content: output.content }))),
})
```

一次工具响应可携带三个值：

| 字段 | 语义 |
| --- | --- |
| `output` | 经 schema 校验的**临时机器值**，Code Mode 消费；不持久化 |
| `content` | 模型可见值，**durable 存储** |
| `metadata` | 有界的工具专有 JSON，供 UI 使用 |

无 `output` 的工具刻意只返回模型可见的 `content` 与可选 `metadata`。动态 MCP 工具与 manifest 工具用同一形状（运行时 JSON Schema）；内建工具与静态插件工具也走同一构造器。schema 接受 Effect Schema 以及同时实现 Standard Schema V1 与 Standard JSON Schema V1 的 schema；codec 必须自包含，schema 转换不得要求服务，工具依赖在构造期获取并被 `execute` 捕获。

## 2. 每次调用的 durable 身份

每个本地工具收到同一份具体调用上下文：

```ts
interface Tool.Context {
  readonly sessionID: Session.ID
  readonly agent: Agent.ID
  readonly messageID: SessionMessage.ID  // 包含该调用的 assistant 消息的 durable ID
  readonly callID: string                // durable 事件使用的调用标识
  readonly progress: (update: Progress) => Effect.Effect<void>
}
```

`messageID` 由 Session runner 拥有并提供，registry 不自行推断；解码后的输入单独传给 `execute`，原始 provider 输入与领域服务不进调用上下文。Effect 中断即取消语义：工具可以把预期的类型化失败翻译成 `ToolFailure`，但**不得**把中断或 defect 翻译成模型可见失败。

## 3. Scope 化的注册覆盖

工具在注册时获得名字（记录键即作者命名），注册时归一化名字（不支持的字符替换为 `_`，`execute` 为 Code Mode 保留字）。规则：

- 同一 placement 内，**最新活动注册获胜**；关闭某次注册只移除它自己；关闭获胜者会显露出次新的活动注册。
- 事后修改调用方的注册记录不改变已捕获的注册。
- Location 插件只拿到窄化的 `Tools` 注册能力而非内部 registry；每次激活获取该 Location 的服务、构造工具，并在插件自有的新 Scope 里注册。
- 内建工具用同一契约，但可捕获应用工具拿不到的受信 Location 服务（文件系统、权限等）——**共享工具类型不等于同等权威**，权限断言由受信工具自行组织（`PermissionV2.assert`），registry 不注入权限助手。

## 4. 请求快照与执行管线

Location 作用域 registry 通过**请求级快照**把“已广告的 LLM 定义”与“捕获的工具值”配对。每个本地调用的执行管线：

1. 解析一个有效的具名注册；
2. 用输入 codec 解码 provider 输入——**无效输入绝不执行**；
3. 以 runner 提供的上下文执行工具；
4. 用输出 codec 编码 `output`，作为 Code Mode 的临时机器值——**无效输出绝不构成成功执行**；
5. 把响应归一化为规范的非空模型内容与可选 JSON metadata；
6. 对模型内容做边界处理；metadata 校验失败或超限时丢弃并告警，而不是让调用失败；
7. 携带规范结果与受管输出路径运行 `execute.after` hooks（hook 可刻意变换结果，变更后的内容会再次归一化与限界）；
8. 向 runner 返回唯一 `ToolOutcome`（completed：output + content + 可选 metadata；error：一个错误 + 可选最终部分快照），由 runner 做 durable 发布。

每个模型请求捕获当时有效的注册；之后的注册变更只影响之后的请求。未知调用、被 hook 移除的调用、最终 Step 的调用都经同一执行缝隙**逐个**失败，互不累及；最终 Step 在 provider 支持时保留工具定义并置 `toolChoice: "none"`，让缓存的 prompt 前缀存活。

## 5. 输出边界与保留

- **生产者与 registry 各拥其界**：进程类工具可对保留不下的输出先行截断或落盘，但必须如实报告自己的损失，不得声称能重建已丢弃的字节。
- 执行后 registry 对发往 provider 的模型内容限界：只测量文本部分（原生媒体不变），默认保留头+尾并在中间插入省略标记；超限文本保留到受管存储并以有界预览替换；完整保留失败时按操作性失败处理，而不是发布有损成功。
- metadata 独立校验与计量，绝不成为无界侧信道；受管路径不会只为了保留记账而出现在 `Tool.make` 或输出 schema 里。
- durable 终态事件自包含：成功恰好存非空模型内容 + 可选 metadata；失败存一个错误 + 至多一个最终部分快照。provider 回放从规范内容推导线上值；协议要求原样保留的 provider 托管载荷放在 provider 自有结果状态，绝不进通用结果字段。

## 6. 失败语义与法则

结果保持四分：`ToolFailure`（预期、模型可见）、中断（取消调用，不是工具结果）、意外类型化错误与 defect（走 runner 的操作性失败策略）、未知/无效调用（不执行工具，成为显式模型可见执行错误）。在 `execute` 外围宽泛捕获得不偿失——会吞掉中断与 defect。

`specs/v2/tools.md` 的法则清单：**单一执行**（`Tool.make` 只能执行 `config.execute`）、**codec 边界**、**规范表示**（完成调用恰好一份存储表示，失败恰好一个错误加至多一个最终快照）、**metadata 显式 opt-in**、**durable 身份**、**Scope 化注册**、**捕获执行**（调用执行的是其模型请求中广告的那个注册）、**逐调用拒绝**、**存储封装**。

## 源码锚点

- [`sources/opencode/specs/v2/tools.md`](../../sources/opencode/specs/v2/tools.md)：工具语义契约
- [`sources/opencode/packages/plugin/src/`](../../sources/opencode/packages/plugin/src)：公共工具类型
- [`sources/opencode/packages/core/src/tool/`](../../sources/opencode/packages/core/src/tool)：registry、runtime 与内建工具（`plugin/` 子目录）
- [`sources/opencode/packages/core/src/permission.ts`](../../sources/opencode/packages/core/src/permission.ts)：权限断言入口
