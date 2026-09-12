# M12 · 框架机制本体

本模块合并原 17、26，直接观察 Cordis 提供给上层 DSH 的两类基础机制：**事件派发语义**与**Fiber 生命周期资源**。

## 运行

```bash
npm run M12
```

## 机制对照

| 机制 | 独立插件 | 重点 |
|---|---|---|
| Dispatch | `steps/01-dispatch-modes.ts` | emit、parallel、serial、bail、waterfall 的返回值和执行顺序 |
| Timer | `steps/02-cordis-timer.ts` | timeout、interval、throttle、debounce 与 Fiber dispose |

派发示例还展示 `bail` 遇到异步监听者会直接泄露 Promise，以及 `return 0` 也会截链的边界。Timer 示例证明插件卸载时挂起 timeout 被拒、interval 与节流监听器自动回收，不留下后台资源。

**结论：**选择错误派发模式会改变控制流；不把资源绑定 Fiber 会破坏可卸载性。框架机制是所有上层插件语义的底座。


## A4 · Cordis 三个组合机制

- Fiber 在依赖缺失时保持 `PENDING`，依赖满足后转为 `ACTIVE`。
- `isolate` 为同名服务建立独立解析 realm。
- `intercept` 按调用域叠加配置，不复制服务实例。
