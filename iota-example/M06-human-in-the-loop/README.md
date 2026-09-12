# M06 人在环路

> **对齐：部分等价（类 A ACP permission；类 C planMode）**

本例不启动子进程，直接驱动真实 `DshAcpAdapter` 的协议级反向请求处理：默认 `permission_policy=reject` 按 option `kind` 返回拒绝，证明不会丢请求导致整轮挂死。`planMode` 属 harness 与人共享的工作面，不加入 orchestrator；依据 `docs/architecture/kernel-replacement.md` §5.1。

```bash
env -u PYTHONHOME -u PYTHONPATH .venv/bin/python M06-human-in-the-loop/run.py
```
