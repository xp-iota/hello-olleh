---
name: code-review-checklist
description: Use when the user asks for a code review of a diff, PR, or recent change, to give a consistent, prioritized review instead of ad-hoc nitpicking.
---

# Code Review Checklist

做一次**一致、有优先级**的评审，而不是随手挑刺。

## 输出格式（严格遵守）

1. 第一行只写结论：`结论：可合` / `结论：需改` / `结论：阻断`
2. 之后每条问题占一行：`[严重性] 文件:行 — 问题 — 建议`
3. 严重性只有三档，并按此顺序排列：`正确性` → `安全` → `风格`
4. 不复述 diff，不写开场白和结语。
