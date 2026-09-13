# M12 · 框架机制本体

Cordis 用事件派发语义定义监听者如何组合，用 Fiber 生命周期定义监听器与资源何时回收。

## 学习目标

理解控制流、依赖状态、服务隔离与调用域配置如何构成可组合、可卸载插件的底层纪律。

## 运行

```bash
npm run M12
```

## 阶段与观察点

| 阶段 | 类型 | 实现 | 观察什么 |
|---|---|---|---|
| 1 Dispatch | 教学主线 | `steps/01-dispatch-modes.ts` | emit、parallel、serial、bail、waterfall 的顺序与返回值 |
| 2 Timer | 教学主线 | `steps/02-cordis-timer.ts` | timeout、interval、throttle、debounce 与 Fiber dispose |
| 3 Fiber 状态机 | 扩展面 | `steps/03-fiber-state-machine.ts` | 依赖缺失时 PENDING，满足后转为 ACTIVE |
| 4 Isolate realm | 扩展面 | `steps/04-isolate-realm.ts` | 同名服务的独立解析域 |
| 5 Intercept config | 扩展面 | `steps/05-intercept-config.ts` | 按调用域叠加配置而不复制服务实例 |

## 完整链路

插件注册监听器和定时资源；派发模式决定组合方式；Fiber 跟踪依赖与 effect；isolate 改变服务解析域；intercept 为调用域提供配置视图。插件卸载时资源沿 Fiber 统一回收。

## 边界

`bail` 不等待异步监听者；无法接受 Promise 泄露时必须改用合适的异步派发模式。

**结论：**错误的派发模式会改变控制流，脱离 Fiber 的资源会破坏可卸载性。
