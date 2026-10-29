# OpenClaw 知识库工作区

`workspace/` 是微信读书笔记整理与检索所使用的 Markdown 工作区。OpenClaw 可将此目录配置为工作区入口，并遵循其中的 `AGENTS.md` 读取流程、来源边界和写回规则。

此目录不依赖专用的 OpenClaw JSON 配置文件；具体配置方式取决于本机安装版本。请在 OpenClaw 中把工作区指向本目录下的 `workspace/`，不要误用仓库中其他项目或旧版助手配置。

## 工作区内容

- `workspace/AGENTS.md`：知识库工作流与回答规则
- `workspace/IDEA_CAPTURE_WORKFLOW.md`：从微信读书来源到知识卡的整理流程
- `workspace/sources/`：书目和来源笔记
- `workspace/concepts/`、`actions/`：概念与行动卡
- `workspace/collections/`、`ideas/`：主题包与想法种子
- `workspace/_templates/`：新条目模板
- `workspace/taxonomy/`：受控词表

## 主要工作方式

先根据问题查找已有主题包、卡片和来源，再回答并给出来源线索。需要写回时，先从来源笔记开始，确认书中观点与个人判断的边界，再按需生成概念卡、行动卡或主题包。不要把同步的原始导出直接当作已审核知识。

仓库级操作说明见 [微信读书知识库说明](../README.md) 和 [同步工具说明](../../.weread-sync/README.md)。
