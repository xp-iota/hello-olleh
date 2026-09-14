# M06 · 人在环路

> **对照关系：语义等价 + 结构性边界**

验证 ACP permission 必定得到答复，并识别计划模式的宿主边界。

## 运行

```bash
env -u PYTHONHOME -u PYTHONPATH .venv/bin/python -m runtime.runner M06
```

## 观察点

1. 无匹配策略时选择什么
2. 请求是否及时闭合
3. `plan_mode` 是否属于 AgentConfig

运行器会先打印目标与观察点，再输出逐项事实、机器可读 JSON 和 `IOTA_MODULE_OK`。任何事实不符都会抛出带“期望/实际”的 `TeachingCheckError`。

## 边界

ACP Adapter 负责闭合权限请求；计划模式由具体内核或宿主管理。

**结论：**人在环路必须 fail closed；编排层不应为形状一致而伪造宿主状态。
