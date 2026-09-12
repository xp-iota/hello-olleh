# Feishu MCP 配置手记

> 把 `hermes sessions清理手记.md` 发到 `xiaopeng.feishu.cn/wiki/DN3swIrSii17axkuKjwcsncxnEc` 需要先打通 Claude Code → 飞书开放平台的链路。本文记录完整配置过程。

## 0. 前置结论

- **`~/.claude/settings.json` 不接受 `mcpServers` 字段**（官方 schema 验证直接拒绝），
  不要尝试在那里加。正确位置是用户级配置（`claude mcp add` 写入 `~/.claude.json`）
  或项目级 `.mcp.json`。
- 飞书/Lark 的官方 MCP 包是 **`@larksuiteoapi/lark-mcp`**（v0.5.1，larksuiteoapi 维护，
  npm `@larksuiteoapi/lark-mcp`）。社区版 `feishu-mcp` 也存在但功能略少。
- `xiaopeng.feishu.cn` 对应 `--domain https://open.feishu.cn`（中国版飞书），
  国际版 Lark 则用 `--domain https://open.larksuite.com`。
- **Lark MCP 用 CLI args（`-a` / `-s` / `--domain`）传凭据，不读环境变量**，
  所以配置文件必须直接写 App ID + Secret，不能用 `${FEISHU_APP_ID}` 占位。

## 1. 创建飞书自建应用

打开 https://open.feishu.cn/app ，用 xiaopeng 租户管理员账号登录：

1. 点击「创建企业自建应用」
2. 名称：`mcp-publisher`（或任意你喜欢的）
3. 描述：用于 Claude Code 通过 MCP 发布文章
4. 进入应用详情页：
   - **凭证与基础信息** → 复制 `App ID`（`cli_xxxxxxxxxxxx`）和 `App Secret`
   - **权限管理** → 搜索并开通以下 scope（按发布内容需要取舍）：
     - `wiki:wiki`（读写 wiki 节点 — 必须）
     - `docx:document:readonly` / `docx:document`（读写飞书文档）
     - `drive:drive`（操作云空间 — wiki 节点内容修改可能需要）
     - `bitable:bitable`、`sheets:spreadsheet`（按需）
   - **版本管理与发布** → 创建版本 → 提交审核 → 等待管理员通过
     （企业内部应用通常自动通过，租户管理员审核后才生效）

## 2. 把应用加到目标 wiki 节点的可编辑列表

这一步 **不做的话 token 就是合法的也会 403**：

1. 浏览器打开 https://xiaopeng.feishu.cn/wiki/DN3swIrSii17axkuKjwcsncxnEc
2. 右上角「分享」→「添加应用」
3. 搜索刚才创建的 `mcp-publisher`，权限设为「可编辑」
4. 保存

## 3. 注册 MCP server 到 Claude Code

凭据就绪后，在终端（Git Bash 或 PowerShell 都行）执行：

```bash
claude mcp add feishu -- \
  npx -y @larksuiteoapi/lark-mcp mcp \
  -a "cli_xxxxxxxxxxxxxxxx" \
  -s "你的_app_secret_原始值" \
  --domain "https://open.feishu.cn"
```

> `--` 之后整段是 stdio 命令；`npx` 会首次运行时拉 `@larksuiteoapi/lark-mcp`。
> 第一次启动会下载 ~32 MB 包，要等几秒。

验证注册结果：

```bash
claude mcp get feishu
```

正常会输出：

```
feishu:
  Status: ✓ connected
  Command: npx
  Args: ["-y","@larksuiteoapi/lark-mcp","mcp","-a","cli_xxx","-s","xxx",
         "--domain","https://open.feishu.cn"]
```

如果 `Status: ✗ failed` 看 stderr 找原因（通常是 App Secret 错或应用未发布）。

## 4. 重启 Claude Code 让配置生效

当前 session 已经在跑，配置变更不会自动加载。**关掉重开**：

```bash
# 当前 session 退出
exit
# 重启 claude
claude
```

新 session 启动后，工具列表里会多出一组 `mcp__feishu__*` 工具，例如：

```
mcp__feishu__list_wiki_nodes
mcp__feishu__get_wiki_node
mcp__feishu__create_docx
mcp__feishu__create_block
mcp__feishu__get_block_content
mcp__feishu__search_wiki
...
```

冒烟测试（最小调用验证 token 通）：

```
请用 mcp__feishu__list_wiki_nodes 列出当前租户可见的所有 wiki 空间。
```

第一次返回通常带分页，看响应里 `has_more` 和 `items` 字段。

## 5. 发布文章

待 1-4 步完成、新 session 里 `mcp__feishu__*` 工具可用后，再发起：
"把 `hermes sessions清理手记.md` 发布到节点 DN3swIrSii17axkuKjwcsncxnEc"

预期执行流程：

1. 读 `D:/coding/creative/hello-olleh/hermes sessions清理手记.md` 全文
2. 调 `get_wiki_node` 拿到节点对应的 docx document_id
3. 解析 markdown → 飞书 block 序列：
   - `# H1` → `heading1`
   - `## H2` → `heading2`
   - 普通段落 → `text`（带加粗/行内代码等 marks）
   - 代码块 ``` ``` → `code`（language 字段识别）
   - 表格 `| ... |` → `table`
   - 列表 `-` / `1.` → `bullet` / `ordered`
4. 调 `create_block` 按顺序插入；每批最多 50 块（API 上限）
5. 最后调 `get_block_content` 抽样校验 1-2 个 block，确认渲染无误

> 注意：飞书 wiki 节点的 docx 内容是「覆盖式更新」还是「追加」，由 `create_block`
> 的 `document_id` + `block_id`（父节点）决定。一般写到一个新临时 docx 再 `move_object`
> 替换原节点更安全，但 lark-mcp 是否暴露 `move_object` 需要实际跑一次看工具列表。

## 6. 故障速查

| 现象 | 原因 | 排查 |
|---|---|---|
| `claude mcp add` 报 `--` 错 | shell 把 `--` 吞了 | 用单引号包整段命令，或 PowerShell 加 `--%` |
| `claude mcp get feishu` 报 `failed` 1s 内 | App Secret 错或未发布 | 去 https://open.feishu.cn/app 看应用是否「已发布」 |
| `failed` 报 `tenant_access_token: invalid app_id` | `-a` 写错了，注意 `cli_` 前缀 | 重新复制 App ID |
| `failed` 报 `domain not match` | 国际/中国域名混了 | 中国版固定 `--domain https://open.feishu.cn` |
| token OK 但 `get_wiki_node` 返回 403 | 应用没被加到该节点的可编辑 | 回第 2 步 |
| 工具列表里没有 `mcp__feishu__*` | session 没重启 | `exit` 后 `claude` 重开 |

## 7. 完成后的清理（可选）

如果只想在 `xiaopeng` 这个项目用，把 MCP 注册做成项目级而不是用户级更干净：

```bash
# 1. 先撤掉用户级
claude mcp remove feishu

# 2. 在项目根写 .mcp.json
cat > .mcp.json <<'JSON'
{
  "mcpServers": {
    "feishu": {
      "command": "npx",
      "args": [
        "-y", "@larksuiteoapi/lark-mcp", "mcp",
        "-a", "cli_xxxxxxxxxxxxxxxx",
        "-s", "你的_app_secret",
        "--domain", "https://open.feishu.cn"
      ]
    }
  }
}
JSON

# 3. 把 .mcp.json 加进 .gitignore
echo ".mcp.json" >> .gitignore
```

`.mcp.json` 进仓库会让 `git status` 多一个待提交文件；上面的方式只在本地生效。
