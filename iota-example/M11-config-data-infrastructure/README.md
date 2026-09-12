# M11 配置与数据设施

> **对齐：部分等价（类 A 配置/存储；类 C 凭证/附件）**

类 A 路径真实投影一个 Claude config profile、替换为内存 ConversationStore，并跑出 dsh 不支持 iota-managed profile 时指向 `--config` 的 fail-loud 错误。凭证与附件由宿主负责，不向 `AgentConfig` 伪加 seam；依据 `docs/architecture/kernel-replacement.md` 的配置边界。

```bash
env -u PYTHONHOME -u PYTHONPATH .venv/bin/python M11-config-data-infrastructure/run.py
```
