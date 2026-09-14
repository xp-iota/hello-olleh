# M11 · 配置与数据设施

> **对照关系：语义等价 + 结构性边界**

区分 profile 投影、可换存储协议与宿主持有的凭证/附件。

## 运行

```bash
env -u PYTHONHOME -u PYTHONPATH .venv/bin/python -m runtime.runner M11
```

## 观察点

1. profile 文件是否生成
2. 不支持的 DSH profile 是否拒绝
3. 内存 ConversationStore 是否读回消息

运行器会先打印目标与观察点，再输出逐项事实、机器可读 JSON 和 `IOTA_MODULE_OK`。任何事实不符都会抛出带“期望/实际”的 `TeachingCheckError`。

## 边界

Profile 与会话存储属于 iota 可治理范围；凭证和附件由宿主持有。

**结论：**配置与存储可以语义对位，但不应把宿主资源硬塞进 AgentConfig。
