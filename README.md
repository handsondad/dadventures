# 微信读书笔记知识库

这个仓库用于同步微信读书中的个人划线与想法，整理成可检索、可复用、可追溯来源的 Markdown 知识库。

## 工作流

```text
微信读书
  -> .weread-sync/raw_notes/       原始 API 数据（划线、想法、章节与定位）
  -> 微信读书笔记/                 按书整理的 Markdown 阅读档案
  -> 微信读书知识库/openclaw/workspace/
       sources/                    书籍与来源笔记
       concepts/ actions/           概念卡与行动卡
       collections/ ideas/          主题包与想法种子
```

`.codebuddy/skills/weread-skills/` 保存微信读书 API 的接口说明；`.weread-sync/scripts/` 提供同步、Markdown 转换和知识库校验脚本。

## 快速开始

在 PowerShell 中设置 API Key 并同步：

```powershell
$env:WEREAD_API_KEY = "你的微信读书 API Key"
python .weread-sync\scripts\sync_final.py
```

将原始 JSON 转成按书归档的 Markdown：

```powershell
python .weread-sync\scripts\json2md.py
```

校验知识库的 frontmatter、ID 与内部引用：

```powershell
python .weread-sync\scripts\validate_knowledge.py
```

详细说明见 [微信读书知识库说明](微信读书知识库/README.md) 和 [.weread-sync 使用说明](.weread-sync/README.md)。

## 个人数据提醒

`.weread-sync/raw_notes/` 和 `微信读书笔记/` 含个人阅读数据，当前会随 Git 仓库跟踪。分享或公开仓库前请检查可见范围；添加 `.gitignore` 不会移除已跟踪文件或 Git 历史中的内容。
