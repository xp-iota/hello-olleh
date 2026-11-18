---
name: demo-greeter
description: 演示「目录即能力」的示例 skill：正文只在被 skill 工具加载时才进上下文。
---

# demo-greeter

GREETER-BODY-42：这段正文在发现阶段不被读取——常驻目录的只有 description。
模型调用 skill 工具之后才看到这一行，这就是「100 个 skill 只付 100 行代价」的原理。