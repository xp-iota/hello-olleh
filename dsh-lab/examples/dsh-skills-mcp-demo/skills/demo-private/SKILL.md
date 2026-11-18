---
name: demo-private
description: 只允许用户显式 /demo-private 手势调用的 skill（模型不可调用）。
disable-model-invocation: true
---

# demo-private

模型经 skill 工具加载我会被拒（not available for model invocation）；
用户消息里的 /demo-private 手势是唯一入口，由 tool-skill 的 pre-step 监听注入。