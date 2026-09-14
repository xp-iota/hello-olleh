# M11 · 配置与数据设施

配置不是任意 JSON 袋；它必须与数据后端、凭证状态、附件和工作区引用保持清晰边界。

## 学习目标

理解 schema、revision、storage domain 与各类 Provider 如何共同保证数据可治理且不泄露秘密。

## 运行

```bash
npm run M11            # 真实 MiniMax（默认）；需要 LLM_API_KEY，会发起网络请求
npm run M11 -- --mock  # 离线确定性机制；不联网、不需要密钥
```

## 阶段与观察点

| 阶段 | 类型 | 实现 | 观察场景 | 观察什么 |
|---|---|---|---|---|
| 1 Settings | 教学主线 | `steps/01-settings-namespaces.ts` | `phases/01-settings-cas-conflict.ts` | 默认值、update、mutate/CAS、replace 与重复注册拒绝 |
| 2 Storage | 扩展面 | `steps/02-json-storage-domain.ts` | `phases/02-route-storage-domain.ts` | JSON backend 与 domain 显式路由 |
| 3 Attachments | 扩展面 | `steps/03-local-attachments.ts` | `phases/03-store-attachment.ts` | content-addressed 本地文件 |
| 4 File references | 扩展面 | `steps/04-local-file-references.ts` | `phases/04-search-workspace-refs.ts` | Agent workspace 内的本地索引 |
| 5 Credentials/Auth | 扩展面 | `steps/05-credentials-authorization.ts` | `phases/05-list-authorization-flows.ts` | 只暴露安全状态与授权流程，不读取 secret |
| 6 Workspace | 扩展面 | `steps/06-workspace-registry.ts` | `phases/06-combine-workspace-session.ts` | storage domain 与 Session persistence 的组合 |

## 完整链路

插件先注册带 schema 的命名空间；revision 为并发写提供 CAS；数据由明确 backend 持有；附件和引用保存定位信息；凭证服务只暴露安全状态；workspace 组合这些能力而不复制数据。

## 边界

`fileUploads` 强依赖 client connection 与 Host 传输面，因此只记录边界，不装载到离线核心 harness。

**结论：**配置保存策略与引用，真实数据由显式 Provider 持有；每个故障边界都应 fail loud。
