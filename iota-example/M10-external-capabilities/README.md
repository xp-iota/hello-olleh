# M10 外部能力接入

> **对齐：等价（类 A）**

本例把数据驱动 `SKILL.md` 同步进临时 kernel home，并通过真实 `IotaMcpServer` 完成 `tools/list` 和 `tools/call` JSON-RPC 往返。全程内存/临时目录，无 webhook、无网络。

```bash
env -u PYTHONHOME -u PYTHONPATH .venv/bin/python M10-external-capabilities/run.py
```
