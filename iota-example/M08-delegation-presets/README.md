# M08 · 委派与预设

> **对照关系：语义等价**

用 GraphSpec 的依赖与绑定表达可验证的节点委派。

## 运行

```bash
env -u PYTHONHOME -u PYTHONPATH .venv/bin/python -m runtime.runner M08
```

## 观察点

1. research→review 拓扑顺序
2. 上游输出如何绑定
3. 图的最终结果

运行器会先打印目标与观察点，再输出逐项事实、机器可读 JSON 和 `IOTA_MODULE_OK`。任何事实不符都会抛出带“期望/实际”的 `TeachingCheckError`。

## 边界

`depends_on` 与 input binding 共同定义委派顺序和数据流。

**结论：**显式 DAG 为委派提供确定、可测试的语义。
