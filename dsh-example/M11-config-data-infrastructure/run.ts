const phases = [
  ['注册并驱动 settings 命名空间', './phases/01-settings-namespaces.ts'],
  ['装配 JSON storage 与 domain 路由', './phases/02-json-storage-domain.ts'],
  ['保存 content-addressed 本地附件', './phases/03-local-attachments.ts'],
  ['按 Agent workspace 搜索文件引用', './phases/04-local-file-references.ts'],
  ['只读取凭证状态并列出授权 flow', './phases/05-credentials-authorization.ts'],
  ['组合 workspace 与耐久 Session', './phases/06-workspace-registry.ts'],
] as const

console.log('\n████ M11 · 配置与数据设施：配置、存储、附件、凭证与工作区 ████')
for (const [index, [title, path]] of phases.entries()) {
  console.log(`\n════════ M11.${index + 1} · ${title} ════════`)
  await import(path)
}
console.log('\n结论：配置只保存引用和策略；真实数据由显式 backend/provider 持有，domain、credential 与 workspace 都在故障边界上 fail loud。')
