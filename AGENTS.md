# Repository Guidelines

## Project Structure & Module Organization
`hello-olleh` is a comparison-and-analysis workspace for AI Coding CLI projects. The primary upstream source snapshots are in `sources/claude-code/`, `sources/codex/`, `sources/gemini-cli/`, `sources/opencode/`, `sources/cordis/`, `sources/deepseek-harness/`, `sources/pi/`, and `sources/openclaw/`; treat them as vendor trees unless a task explicitly requires source edits inside one of them. The main authored output lives in the matching `docs/hello-*` directories, where analysis is split into topic-focused Markdown chapters.

**Current upstream versions:**
- Claude Code: v2.1.87 (decompiled snapshot)
- Codex: rust-v0.162.1
- Gemini CLI: v0.63.0
- OpenCode: v2.0.27
- Hermes Agent: v2026.9.24 (package version 0.21.5)
- Nanobot: v0.3.5
- Cordis: 4.0.0-rc.13
- DeepSeek Harness: 0.2.2-rc.3
- Pi: v1.1.0
- OpenClaw: v2026.10.2

The repository has no static site generator: `docs/` is plain Markdown read directly on GitHub, so every link must resolve to a real file and no page carries generator-specific front matter. Root files remain lightweight: [`README.md`](README.md) records scope and upstream versions, and [`sync_repos.sh`](sync_repos.sh) refreshes local clones into `sources/`.

`dsh-lab/` is the companion runnable workspace for the DeepSeek Harness and Cordis analyses, restructured (2026-11-17) into **one article, one project**: `examples/` holds **21 fully independent examples** (6 cordis + 15 dsh), each with its own `package.json`, assembly manifest, topic article (`README.md`), and Node/Bun scripts — copy a directory anywhere, `npm install`, and it runs. The old M01–M12 module system (60 phases + shared boot tree + root `chat`/`traj` CLI) is **retired**; `dsh-example/` (0.1.5-rc.2) remains historical. Examples target `@deepseek-ai/*` **0.2.2-rc.3** (npm `next` channel, same version as the source snapshot) with `@deepseek-ai/cordis` **4.1.0**; dsh examples assemble through the official `boot()` + declarative `cordis.patch.yml` — no hand-wired services. The fullest tree is `dsh-chat-demo` (89 rows, interactive terminal with `chat`/`sessions`/`traj`/`info` subcommands, self-written `anthropic-compat` adapter and `safety-guardrail` plugin copies). There is no mock or offline path: the two key-dependent examples (`dsh-llm-adapter-demo`, `dsh-chat-demo`) really call a provider and fail loudly without `LLM_API_KEY` (each reads its **own** directory's `.env`, gitignored, template in `.env.example`); mechanism paths need no key. Root scripts: `example:<name>` / `example:<name>:bun` (proxy to an example's `start`), `install:all`, `verify`, `runtime:status`, `check:shim`; the root layer itself is zero-dependency.

`dsh-lab/` runs on **two runtimes**, both verified to produce identical results: latest Node.js (**v26.12.1**, Current line) and latest Bun (**v1.4.4**). Versions live in `dsh-lab/runtime/runtimes.json`; `npm run runtime:status` reports what resolves and whether it meets the minimum (Node **>= 22.18** for native TypeScript type stripping; Bun **>= 1.4.4**). Each example's `:bun` scripts go through its own mini dispatcher (or the root `runtime/run.mjs` for root-level tools); `DSH_RUNTIME=bun` or the `:bun` suffix switches the runtime. `npm run verify` iterates `examples/` and runs **typecheck + start (Node) + start:bun (Bun)** per example, ending in `RUNTIMES_VERIFY_OK runtimes=2 checks=63`; key-dependent examples without a key are reported as explicit fail-loud entries (△), never silently skipped. Note `npm run example:dsh-sandbox-demo -- --runtime bun` does **not** work (`--runtime` is npm's own flag, `EUNKNOWNCONFIG`) — use the `:bun` variant.

Bun 1.4.4 differs from Node on two seams dsh depends on (shape unchanged in rc.3), fixed **inside each affected example's own `runtime/`** without touching `node_modules`; the root `dsh-lab/runtime/` keeps the reference copy. (1) It lacks `node:module.stripTypeScriptTypes`, so `@deepseek-ai/dsh-ptc-runtime-node` fails to link, `ptc-runtime` silently never activates, and the tool count drops from **27 to 26** (rc.3 added `wait_agent` on top of the rc.1 baseline of 26) — `runtime/bun-preload.mjs` patches that package's import at load time to `runtime/lib/bun-shim.mjs` (a `Bun.Transpiler` implementation that preserves the 35-byte prefix / `\n}` suffix the upstream `slice(35, -2)` depends on; `npm run check:shim` guards this). (2) Bun swallows the first `--` after the script path, which breaks the `dsh-subprocess-local` runner protocol — the same preload restores it for the runner entry only. The preload must be injected via `BUN_OPTIONS` (not command-line `--preload`), because the runner is a grandchild process; `runtime/lib/spawn.mjs` owns that injection. `dsh-chat-demo`'s `info` subcommand is the boot probe (19 required services + 27 tools, machine-readable `BOOT_PROBE` line, non-zero exit on mismatch) — it catches the silent Bun degradation. Thinking-budget note: fuyao-gateway reasoning models spend small `maxTokens` budgets entirely on `thinking` (measured: 1024 still yields zero text); the adapter rows configure **8192**.

`dsh-web/` is **not** part of this repository. It is a standalone TypeScript project with its own Git repository and remote: `git@github.com:xp-iota/dsh-web.git` (branch `main`). It is a read-only chat Web service on top of `@deepseek-ai/dsh` 0.2.1-rc.2 — a hand-rolled `node:http` + SSE layer (no web framework), a React 19 + Vite 6 front end under `web/`, and the same Node/Bun dual-runtime idea as `dsh-lab/` (`runtime/run.mjs` dispatch; `npm run verify` ends in `RUNTIMES_VERIFY_OK`). The container image ships both runtimes and picks one via `DSH_RUNTIME`. Because it carries its own `.git`, the parent repo reports `?? dsh-web/` — **never `git add dsh-web/` here**; that would record a gitlink, not the source. Work on it inside `dsh-web/` with its own commits and push them to its own remote.

The DSH analysis set was consolidated from 26 chapters into 12 files (11 topic chapters `01`–`11` plus the cross-framework comparison `12`); section numbers were renumbered consecutively and every merged file records its original sources in a 📎 note. The consolidation helpers are migration scripts rather than daily generators: `scripts/merge_dsh_docs.py` and `scripts/rewrite_dsh_refs.py` detect the final 11-chapter layout and exit safely, while `scripts/link_examples_into_docs.py` is now **retired** (it targeted the first-edition Chinese filenames and would re-insert `dsh-example/` links; it exits without touching anything). Validate cross-references with `python3 scripts/check_doc_links.py .`.

⚠️ **Version alignment and remaining exceptions.** The prose analyses the `0.2.2-rc.3` source snapshot (`sources/deepseek-harness/`, tag `dsh-v0.2.2-rc.3`, 2026-11-13), and since the 2026-11-17 restructure the examples run the **same** `0.2.2-rc.3` packages (npm `next` channel). Remaining exceptions, all measured: `dsh-invariants` has no rc.3 (latest is `0.2.0-rc.2`, peer-declares cordis ~4.0.4) — `dsh-chat-demo` carries a `.npmrc` with `legacy-peer-deps=true`, whose side effect is that npm stops auto-installing **any** peerDependencies, so all 26 peer packages are explicit dependencies there (127 total); rc.3's `agentDefaultModel` is a plain config service — entry points must read `currentSelection()` themselves (chat-demo's REPL does); rc.3's `web-deepseek-api` row takes no config. Wherever a 📐 block says "以本快照的源码分析为准", that assertion has **no runnable counterpart** in the examples — do not present it as measured there.

## Build, Test, and Development Commands
There is no single monorepo build. Use the command that matches the area you changed.

- `bash ./sync_repos.sh`: clone or refresh the upstream repositories listed in the script.
- `git status --short`: confirm your change set is limited to the intended docs or snapshot updates.
- `rg --files docs/hello-*`: list generated analysis files before adding a new note or index.
- `python3 scripts/check_doc_links.py .`: verify every local Markdown and HTML link resolves.

If you edit code inside a vendored repo, run that repo's native checks from its own directory and record the exact command in your PR or task summary.

Vendored snapshots must contain source-controlled files only. Do not retain nested `.git` directories, `node_modules`, package build output (`lib/`, `.dsh-build/`), or tool caches in `sources/`.

## File Encoding Requirements

**All Markdown files must be UTF-8 without BOM.** A UTF-8 BOM (`\xEF\xBB\xBF`) at the start of a file breaks YAML front-matter parsing and shows up as stray characters in the first heading.

Before committing new markdown files, verify they have no BOM:
```bash
xxd your-file.md | head -1   # Should start with ---, not efbb bf
```

Or in Python:
```python
with open('your-file.md', 'rb') as f:
    has_bom = f.read(3) == b'\xef\xbb\xbf'
```

If you find a BOM, remove it:
```python
with open('your-file.md', 'rb') as f:
    content = f.read()
if content.startswith(b'\xef\xbb\xbf'):
    with open('your-file.md', 'wb') as f:
        f.write(content[3:])
```

## Coding Style & Naming Conventions
Prefer short, source-backed Markdown sections with concrete headings. Follow existing filename patterns with ordered prefixes such as `01-architecture.md`, `06-context-and-memory.md`, `28-ghost-snapshot.md`, or `38-mainline-index.md`. Keep one major topic per file and place new notes in the matching `docs/hello-*` directory. Preserve the language already used in the file or folder you edit instead of mixing styles casually.

## Testing Guidelines
For documentation changes, manually verify headings, relative links and referenced paths, then run `python3 scripts/check_doc_links.py .`. Diagrams are Archify artifacts, so also confirm the embedded SVG, the interactive HTML link and the IR link all resolve.

There is no root coverage target. For source changes inside `sources/claude-code/`, `sources/codex/`, `sources/gemini-cli/`, or `sources/opencode/`, rely on the upstream project's own lint and test commands and summarize the results in the PR.

## Commit & Pull Request Guidelines
Recent commits use short, imperative English subjects such as `Add Claude Code documentation and resources` or `docs: refresh pages editorial style`. Keep commits focused on one analysis area, one site/theme change, or one snapshot update. PRs should mention the upstream repo and version affected, list changed directories, and note any validation commands you ran. Include screenshots when visual artifacts such as the Pages homepage, content layout, diagrams, or PDF presentation materially changed.

## Commit Identity & Co-Authorship Rules

**Rule: The tool identity that makes the commit MUST match the Co-authored-by.**

### Identity Table

| Committing Tool | Author | Co-authored-by |
|:----------------|:-------|:---------------|
| Claude | `Claude <noreply@anthropic.com>` | `Co-authored-by: Claude <noreply@anthropic.com>` |
| Codex | `Codex <noreply@openai.com>` | `Co-authored-by: Codex <noreply@openai.com>` |
| Gemini | `Gemini <noreply@google.com>` | `Co-authored-by: Gemini <noreply@google.com>` |
| OpenCode | `OpenCode <opencode@ai.local>` | `Co-authored-by: OpenCode <opencode@ai.local>` |
| MiniMax Code | `MiniMax Code <noreply@minimax.io>` | `Co-authored-by: MiniMax Code <noreply@minimax.io>` |

### Commit Template

```bash
git commit -m "<type>: <message>" \
  --author="<ToolName> <noreply@xxx.com>" \
  -m "Co-authored-by: <ToolName> <noreply@xxx.com>"
```

### Examples

```bash
# When Claude makes the commit
git commit -m "docs: update architecture" \
  --author="Claude <noreply@anthropic.com>" \
  -m "Co-authored-by: Claude <noreply@anthropic.com>"

# When Codex makes the commit
git commit -m "docs: update architecture" \
  --author="Codex <noreply@openai.com>" \
  -m "Co-authored-by: Codex <noreply@openai.com>"
```

### Git Config (Repository-level)

```bash
# Set for this repo only (not global)
git config --local user.name "Codex"
git config --local user.email "noreply@openai.com"
```

## First-Class Tooling: OKF, archify, graphify

Three upstream projects are **first-class citizens** of this workspace. They are not optional helpers — they define how analysis is produced, how diagrams are drawn, and how knowledge is indexed. Prefer them over ad-hoc alternatives.

| Tool | Role in this repo | Local location | Status |
|:-----|:------------------|:---------------|:-------|
| [OKF](https://github.com/GoogleCloudPlatform/open-knowledge-format) v0.2 | Knowledge format for analysis output and cross-repo exchange | `tools/okf/SPEC-v0.2.md` (vendored spec) | Spec only, no install needed |
| [archify](https://github.com/tt-a1i/archify) v2.14 | All diagrams in `docs/hello-*`; replaces Mermaid | `tools/archify/` (vendored skill) | Installed, verified |
| [graphify](https://github.com/Graphify-Labs/graphify) v0.9.53 | Knowledge graph over code + docs; query instead of grep | `.tools/graphify/` (runtime, gitignored) + `tools/graphify/SKILL-kiro.md` | Installed, verified |

### Division of labour

Keep the three from overlapping. They answer different questions:

- **graphify → "where is it and what touches it?"** Structural discovery. Run it before writing new analysis so the chapter outline follows real dependencies rather than guesses. Use it instead of repeated `grep` sweeps across `sources/`.
- **archify → "what does it look like?"** Every diagram. Authored as typed JSON IR, validated, then compiled to a self-contained HTML artifact.
- **OKF → "how is the conclusion stored so others can reuse it?"** The output format for durable, provenance-carrying knowledge.

Typical flow for a new analysis chapter: `graphify` builds the graph → read the graph to pick the real call chains → write the chapter in Markdown → `archify` for the diagrams → record durable concepts as OKF docs with `sources` provenance.

---

### OKF — Open Knowledge Format v0.2

⚠️ **The canonical repo has moved.** OKF now lives at [`GoogleCloudPlatform/open-knowledge-format`](https://github.com/GoogleCloudPlatform/open-knowledge-format). The `okf/` directory under `GoogleCloudPlatform/knowledge-catalog` is a **frozen, unmaintained snapshot** — its own README says "Stop using the copy under `okf/`". Read the spec and file issues against the canonical repo. The vendored copy at `tools/okf/SPEC-v0.2.md` is a convenience snapshot for offline reading; treat upstream as the source of truth.

OKF is a vendor-neutral format, not a product: knowledge is plain Markdown files with YAML frontmatter in a directory hierarchy, cross-linked into a graph. No SDK, no query language — `cat` is a valid reader.

Rules when authoring OKF in this repo:

- `type` is the **only always-required** frontmatter key (SPEC §4). A doc carrying just `type` is already conformant.
- Use frontmatter for the few fields worth querying/filtering (`type`, `resource`, `tags`, `status`); use the Markdown body for prose, schemas, and examples.
- Provenance and freshness are first-class in v0.2 — carry `sources` (each entry requires `resource`), `generated.by` (an actor per §7), `verified`, `status`, and `stale_after`. This is what makes an agent-maintained corpus trustable. Do not omit them for concepts an agent generated.
- Cross-links are normal Markdown links with paths absolute from the bundle root, e.g. `[customers](/tables/customers.md)` (SPEC §6). Links form the graph; the directory tree only expresses parent/child.
- Every directory gets an `index.md` listing (§8) so an agent can navigate one level at a time instead of loading the whole bundle. Bundles track history in `log.md` (§9).
- Extra frontmatter keys and body sections are allowed; a small required core keeps consumers interoperable. Check §11 for conformance before claiming a bundle is OKF-conformant.

The upstream reference agent (BigQuery + Gemini) and its `visualize` subcommand are proof-of-concept producer/consumer implementations. **They are not required here** — this repo authors OKF by hand or via agents. Note that a PyPI package named `okf` exists but its provenance is unverified; do not adopt it without checking it against the canonical repo.

### archify — validated diagrams

archify replaces Mermaid across `docs/hello-cordis/` and `docs/hello-dsh/`. Agents write typed JSON IR; archify deterministically compiles and **validates** it, so layout defects are caught by a checker instead of by a reader.

GitHub access is intermittent in some sandboxes. The skill was obtained from npm (`@tt-a1i/archify-dsh`) and vendored to `tools/archify/`, which is self-contained — `node tools/archify/bin/archify.mjs doctor` must report all checks green before use.

Conventions:

- IR at `docs/<set>/diagrams/<slug>.<type>.json`, artifact at `docs/<set>/diagrams/<slug>.html`, and a self-contained `docs/<set>/diagrams/<slug>.svg` for inline rendering.
- In Markdown, embed the SVG with `![title](diagrams/<slug>.svg)`, then a line linking the interactive HTML and the IR source, then the IR's three `cards` flattened into bullets. The HTML artifact alone does not render in Markdown, and the `cards` prose lives outside the SVG — both are needed for a Markdown-only reader to get the whole picture.
- Pipeline per diagram: `validate --quality showcase` → repair → `deliver` → `visual-check` → `extract-svg` → `inline-svg-into-md`. A showcase pass means all 9 artifact checks with 0 errors and 0 warnings. A non-zero exit is never success.
- Helpers: `tools/archify/extract-svg.mjs` pulls a standalone SVG out of a delivered artifact; `tools/archify/inline-svg-into-md.py` rewrites the Markdown blocks; `tools/archify/replace-mermaid.py` swaps Mermaid fences for artifact references; `tools/archify/fit-viewport.mjs` rescales a sequence diagram's `y` coordinates to a target viewBox.

Why `extract-svg.mjs` exists: archify's inline SVG carries only CSS classes, and every colour comes from the artifact's ~180 KB `<style>` block. Copying the `<svg>` element out verbatim yields an unstyled drawing. The script therefore renders the real page in headless Chromium and freezes `getComputedStyle` into presentation attributes, producing an SVG with no CSS dependency. Two things went wrong the first time and are now guarded against:

- `[data-detail]` and `[data-detail-anchor]` look like interaction overlays but actually carry the node labels and sublabels. Only `[data-legend-hit]` may be dropped.
- Freezing styles and stripping `data-*` in a single pass silently breaks descendant selectors such as `svg [data-legend-count-badge] rect` for elements visited later. Do all style reads first, then strip attributes in a second pass.


Type selection matters more than anything else:

- `sequence` for call chains, `lifecycle` for state machines.
- **Use `architecture` for flowcharts, not `workflow`.** The workflow canvas is fixed-size regardless of `viewBox` (`render-workflow.mjs:41-49`: lane width 640, hardcoded column centres `[88, 220, 300, 430, 500, 625]`, default node 92×52). CJK sublabels typically need 116–162px and will not fit. `architecture` has free `pos`/`size`, and its `boundaries` (`kind: region | security-group`, `wraps: [ids]`) map cleanly onto Mermaid `subgraph`.

Recipe that reaches ~80% first-pass acceptance: short `label` + one-line `sublabel` + `tag` for the source location or cross-chapter pointer; prose demoted to exactly 3 `cards` with single-line items; `viewBox` aspect 2.2–2.5 with height hugging the content.

Constraints worth knowing before authoring (each was hit in practice):

1. `sequence` rejects self-messages (`from == to`) with "spans 0px". Fold Mermaid's `X->>X` into an adjacent message's `note`.
2. `sequence` has no `alt`/`opt`. Express branches with `variant` plus `note`.
3. Message `y` must sit in `[160, viewBoxHeight - 83]` and must not land on a `segments` boundary (±12px), or you get `container-border-run`.
4. `lifecycle`: the main lane has columns 0–4; every other lane is an event band with columns 0–2 only. Max 4 lanes.
5. `lifecycle` main-rail pitch is 154px with 118px boxes, leaving a 36px gap — horizontal edge labels need `labelDy` (±25 and up) to clear the boxes.
6. A transition's `note` text is merged into the label rect and widens it. Never put `note` on a crowded corridor; move that text to `cards`.
7. `finite_svg` is a literal scan for `/\b(NaN|undefined|Infinity)\b/`. Writing the word "undefined" in a label fails the check — reword.
8. Bidirectional pairs fight over label space. `right-channel` tends to route over the main rail and collide. The cheapest fix is deleting the purely directional return label and stating it in `cards`.
9. `architecture` `components[].sources` requires `meta.repository` (GitHub URL plus a 40-hex revision). Without it you get "Repository evidence requires /meta/repository" — put file names in `sublabel` instead.
10. Two vertically aligned nodes need explicit `fromSide`/`toSide`, else `clean-flow/endpoint-side-direction` fires.
11. For label collisions, `labelDy` (±40–60) beats `labelDx`, and `route: "straight"` makes it stabler.
12. Node `pos + size` outside `meta.viewBox` fails validation — raise the viewBox whenever you add nodes.
13. `visual-check` containment at 1440×900 is decided mostly by whether the card row wraps. Three cards with single-line items normally fits.
14. `visual-check` writes `*.visual-check.*` screenshots and a contact sheet next to the artifact. Delete them at the end of every batch.

Cross-chapter Markdown links inside node labels cannot survive: archify strings are plain text. Downgrade them to textual pointers such as "见 04 篇 § 4.5" and keep the real link in surrounding prose.

### graphify — queryable knowledge graph

graphify turns a folder of code, docs, PDFs, and images into a persistent knowledge graph so agents traverse structure instead of re-reading files. Code is parsed locally with tree-sitter (deterministic, no model call); non-code assets need a semantic pass. Every edge is tagged `EXTRACTED`, `INFERRED`, or `AMBIGUOUS` — **always report which, never present an `INFERRED` edge as fact.**

Install notes for this workspace:

- The PyPI package is **`graphifyy`**, not `graphify` (the shorter name is being reclaimed); the CLI and skill command are still `graphify`.
- `python3 -m venv` fails here (no `ensurepip`), so install with `pip3 install --target .tools/graphify graphifyy==0.9.53` and run via `PYTHONPATH=/workspace/.tools/graphify python3 -m graphify`. `.tools/` is gitignored.
- The install can fail with `THESE PACKAGES DO NOT MATCH THE HASHES FROM THE REQUIREMENTS FILE` when the index is reached through a mirror that re-serves a different artifact. That is an environment problem, not a version problem: **retry** (add `--no-cache-dir` if the cached artifact is the bad one) rather than pinning a different `graphifyy` version.
- `graphify install --platform kiro` writes into the Kiro config directory, which is **outside `/workspace` and blocked by this environment's directory policy**. The Kiro skill and steering files are therefore vendored to `tools/graphify/` instead; read them from there.

The CLI is an installer and query surface, not the builder: `install`, `path A B`, `explain X`, `diagnose multigraph`, `clone`, `merge-graphs`, `hook install`. Graph construction is driven through the Python modules, in this order:

```
graphify.extract.collect_files(Path(target)) → extract(paths)
  → graphify.build.build_from_json(extraction, directed=True)
  → graphify.cluster.cluster(G)
  → graphify.analyze.god_nodes(G, top_n)
  → graphify.export.to_json(G, communities, output_path)
```

Verified on this repo: `collect_files(Path('scripts'))` found 7 files, `extract` produced 24 nodes and 43 edges all tagged `EXTRACTED`, `cluster` found 8 communities, and `graphify explain "Vault"` resolved to `scripts/rewrite_dsh_refs.py L83` with community and degree.

Also verified on `dsh-lab/` (2026-10-23, **old structure** — M01–M12 + shared `src/`, retired 2026-11-17): 51 files, 396 nodes, 600 edges, 32 communities, `EXTRACTED` 537 / `INFERRED` 63; `diagnose multigraph --directed` reports 0 dangling / 0 self-loop / 0 duplicate. The same data rebuilt **undirected** collapses 12 edges. Full write-up and the rebuild commands live in [`docs/okf/references/01-graphify-dsh-lab.md`](docs/okf/references/01-graphify-dsh-lab.md); the graph needs rebuilding against `examples/` before its numbers are quoted as current facts.

⚠️ **YAML does not enter the AST graph.** `cordis.yml` / `cordis.patch.yml` contribute **0 nodes** — tree-sitter covers code, not config. So "the assembly comes from one declarative manifest" is **not** verifiable from the graph; count it with `rg -c '^\s*- id:' dsh-lab/examples/dsh-chat-demo/cordis.patch.yml` instead.

Two traps:

- **Pass `directed=True` to `build_from_json`.** The default undirected build collapsed the same 43 edges down to 23. Run `graphify diagnose multigraph` when edge counts look suspicious.
- Non-code extraction needs a model. Either let the assistant dispatch subagents, or set `GEMINI_API_KEY` / `GOOGLE_API_KEY` and use `graphify.llm.extract_corpus_parallel(files, backend="gemini")` (default model `gemini-3-flash-preview`, override with `GRAPHIFY_GEMINI_MODEL`). Code-only runs need no key.

Use it for: locating the real call chain before writing a chapter, cross-checking that a claimed dependency exists, and `merge-graphs` to compare two `sources/` snapshots. Graph output belongs in the gitignored `graphify-out/`; do not commit generated graphs.

## Agent Notes
Start with [`README.md`](README.md) before generating new analysis. Then read the First-Class Tooling section above — OKF, archify, and graphify are the default toolchain for analysis, diagrams, and knowledge indexing respectively, and each has non-obvious constraints documented there. Prefer editing `docs/hello-*` outputs over modifying vendored source trees in `sources/`, and avoid committing sync noise unless the snapshot update is intentional.
