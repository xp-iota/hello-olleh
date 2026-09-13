# M12 · 框架机制本体

> **对照关系：语义等价 + 结构性边界**

验证可逆 effect、身份安全 disposer 与 Provider 发现机制。

## 运行

```bash
env -u PYTHONHOME -u PYTHONPATH .venv/bin/python -m runtime.runner M12
```

## 观察点

1. EffectStack 的 LIFO/幂等
2. 失效后注册和错名 capability 的拒绝
3. 标准 entry-point group

运行器会先打印学习目标与观察点，再输出逐项事实、机器可读 JSON 和 `IOTA_MODULE_OK`。任何事实不符都会抛出带“期望/实际”的 `TeachingCheckError`。

## 边界

iota 提供可逆 effect 和注册表，但不复制 Cordis 的 Proxy/Fiber 架构。

**结论：**可借用机制语义，不必为了外形一致搬入完整框架。
