# M10 · 外部能力接入

> **对照关系：语义等价**

验证文件系统 Skill 与进程内 MCP 的真实发现和调用路径。

## 运行

```bash
env -u PYTHONHOME -u PYTHONPATH .venv/bin/python -m runtime.runner M10
```

## 观察点

1. SKILL.md 同步结果
2. MCP `tools/list`
3. MCP `tools/call`

运行器会先打印学习目标与观察点，再输出逐项事实、机器可读 JSON 和 `IOTA_MODULE_OK`。任何事实不符都会抛出带“期望/实际”的 `TeachingCheckError`。

## 边界

Skill 通过文件投影发现，MCP 通过明确协议列出并调用工具。

**结论：**知识资产和外部工具都能在无网络条件下通过真实边界验证。
