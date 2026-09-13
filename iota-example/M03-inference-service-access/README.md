# M03 · 推理服务接入

> **对照关系：结构性边界**

理解 iota 以整个 `KernelAdapter` 为推理替换单元的设计。

## 运行

```bash
env -u PYTHONHOME -u PYTHONPATH .venv/bin/python -m runtime.runner M03
```

## 观察点

1. 第二个 Adapter Provider 是否可注册
2. ACP capabilities 如何进入图编译
3. 不支持的模型 middleware 是否明确拒绝

运行器会先打印学习目标与观察点，再输出逐项事实、机器可读 JSON 和 `IOTA_MODULE_OK`。任何事实不符都会抛出带“期望/实际”的 `TeachingCheckError`。

## 边界

iota 替换整个 `KernelAdapter`，而不是在编排层替换单次 LLM 调用。

**结论：**结构差异应通过 capability 和编译期拒绝表达，而不是静默降级。
