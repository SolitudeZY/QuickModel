# 会话上下文压缩（compaction）机制与本轮提速

本文记录 QuickModel 当前的会话压缩实现、慢在哪、以及 v1.9.21 的改动。代码：`app/advanced_tools.py`（`auto_compact`）、`app/agent.py`（`_manage_context` / `compact_only`）。

## 1. 当前压缩模式（改动前）

触发：每轮发给模型前 `estimate_tokens(历史) > compact_threshold`（默认取模型配置，官方模板 60 万；旧模型 8 万）。同一次 `Agent.run` 内只尝试一次。

结构：`system 头（原样） + <context_summary> 摘要 + 最近 15 条原文`。

1. **保留尾部**：最多 15 条，并按阈值的 35% token 预算收缩，避免最近的大工具结果独占尾部、导致中段为空。
2. **中段整段序列化**：`json.dumps([...])`（去掉图片 base64），按 **60000 字符**切块。
3. **逐块摘要**：每块调一次便宜模型（`_summary_model_config()` 优先名字带 `flash` 的配置），结构化 prompt 要求保留路径/函数名/约束/决策/待办；多块后再做一次「合并摘要」。
4. **失败即放弃**：任何一块失败或超时 → `return messages`，原历史保留、提示用户。
5. **摘要模型兜底**：便宜模型报错时在剩余预算内回退主模型。
6. **前缀缓存**：压缩只做一次、整段替换，之后消息只追加，DeepSeek/OpenAI 的前缀缓存重新热起来。

## 2. 慢在哪（改动前的实测瓶颈）

假设 60 万 token 阈值触发，中段约 240 万字符：

| 环节 | 改动前 |
| --- | --- |
| 分块数 | ≈ 40 块（240 万 / 6 万） |
| 执行方式 | **串行**，一块等一块 |
| 单块输出 | 不设 `max_tokens`，模型常写 3000~6000 token 摘要 → 单块 30~60s |
| 单块超时 | 120s |
| 总预算 | `120 × (块数 + 1)` ≈ 82 分钟（只是上限，但没人拦） |
| 合并 | 再等一次完整摘要请求 |
| 输入体积 | 工具输出全文（read_file / run_command / 网页正文）都进摘要请求，token 浪费在中段大头上 |

所以「压缩太慢」= **串行 × 无输出上限 × 全量工具输出** 三者叠加。

## 3. v1.9.21 的提速改动（保持「不丢正文」不变量）

1. **并行分块**：`ThreadPoolExecutor(max_workers=min(4, 块数))`，结果按原始索引回填，合并顺序不变；进度只从协调线程上报（不并发调 pywebview 桥）。
2. **输出上限**：单块 `max_tokens=1200`，合并 `1600`——摘要是「索引」不是「复述」，超过上限的部分本来就进不了下一轮上下文。
3. **超时收紧**：单块请求 60s、合并 45s；默认总预算改成按**波次**算 `120 × (waves + 2)`（`waves = ceil(块数/4)`），显式 `timeout_seconds` 仍是整个流程的总上限。
4. **摘要输入裁剪**：`_summary_safe_message()` 只裁两类低价值、高体积内容——`tool` 结果保留首尾 3000 字符，`tool_call.arguments` 保留 2000 字符；**user / assistant 正文一律不裁剪**（需求、约束、决策都在正文里）。
5. 完整原文仍写入 `%APPDATA%/AIDesktopAssistant/transcripts/`，摘要里标注存档路径。

改动后同一场景的量级：约 40 块 → 4 路并行 10 波，单块 5~15s，总耗时 1~3 分钟；若工具输出被裁剪后中段变小（常见），块数直接降到个位数。

回归：`python -m unittest tests.test_model_callers`（含 130000 字符中段不被裁剪、显式预算仍生效的用例）。

## 4. 与主流产品做法对照

| 产品 / API | 压缩方式 | 与 QuickModel 的关键差异 |
| --- | --- | --- |
| Claude Code | 会话接近窗口时触发 auto-compact（可用 `/autocompact` 调阈值），把较早历史交给模型生成结构化摘要并替换，system prompt 与 CLAUDE.md 不动，压缩后缓存前缀失效一次；`/compact <focus>` 可指定摘要重点；`/recap` 只展示摘要、不动历史 | 以**单次摘要**为主（依赖长上下文窗口），没有分块并行；压缩后会把最近改动的文件重新读回 |
| OpenAI Codex CLI | 上下文超限时用"摘要 + 保留最近若干轮工具调用/输出"的方式折叠较早条目（工具调用与其输出成对保留，避免拆断） | 同样只保留最近工具轮次，不做分块；较早工具输出直接丢弃 |
| OpenAI Responses API | 服务端压缩：请求带 `context_management.compact_threshold`，服务端按阈值折叠历史；另有独立的 compact endpoint 返回压缩后的条目 | 压缩在厂商侧完成，客户端只保留 opaque 结果；对本地工具结果体积无控制权 |
| ChatGPT 产品 | 长对话滚动摘要 + 记忆条目注入，超出窗口后旧消息以摘要形式保留 | 用户不可见细节、不可调阈值；不面向"工具输出塞满上下文"的 Agent 场景 |
| DeepSeek API | 无服务端压缩；128K/1M 窗口 + 前缀缓存（命中 token 约 1/10 价） | 与 QuickModel 现状最接近：必须自己压缩，且必须保住前缀稳定 |
| QuickModel（本项目） | 本地 `auto_compact`：system 头 + 分块摘要 + 近期尾部，失败不压缩；压缩低频、一次性替换 | 因为要保前缀缓存，**不能**用「每轮就地改写旧工具结果」的滑动窗口（v1.7 前 microcompact 的教训） |

结论：主流做法是「保留最近、折叠较早」，差异只在摘要是一次性长请求还是分块。QuickModel 选分块并行，是为了在 1M 窗口下也能把 240 万字符的中段在 1~3 分钟内折完，同时不丢 user/assistant 正文。

## 5. 可调参数

`app/advanced_tools.py` 顶部常量：

- `CHUNK_CHARS = 60000`：单块字符上限（与「摘要不丢正文」的回归用例绑定）。
- `SUMMARY_OUTPUT_TOKENS = 1200` / `MERGE_OUTPUT_TOKENS = 1600`：输出上限。
- `SUMMARY_REQUEST_TIMEOUT = 60` / `MERGE_REQUEST_TIMEOUT = 45`：单请求超时。
- `MAX_PARALLEL_SUMMARIES = 4`：并行度；遇到便宜模型限流可降到 2。
- `SUMMARY_TOOL_CHARS = 3000` / `SUMMARY_ARGUMENT_CHARS = 2000`：工具输出与参数裁剪阈值。

阈值本身（何时触发压缩）仍由模型配置的 `compact_threshold` 决定，设置页可改。

## 6. 已知取舍

- 并行摘要会让便宜模型的瞬时并发升高（默认 4）；网关限流时表现为某块超时 → 整体失败并保留原历史，不产生半压缩状态。
- 工具输出裁剪后，摘要里对超长报错/目录树的细节会变粗；完整原文在 `transcripts/` 里可查。
- 压缩仍会让该会话的 prompt cache 整体失效一次（system 前缀不变，但中段变了），这是所有"替换历史"方案共有的代价。
