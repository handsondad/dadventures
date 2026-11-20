# 微信读书笔记知识库

这个仓库用于同步微信读书中的个人划线与想法，整理成可检索、可复用、可追溯来源的 Markdown 知识库。

## 工作流

```text
微信读书
  -> .weread-sync/raw_notes/       原始 API 数据（划线、想法、章节与定位）
  -> notes/                        按书整理的 Markdown 阅读档案
  -> kb/                           知识库
       sources/                    书籍与来源笔记
       concepts/ actions/          概念卡与行动卡
       collections/ ideas/         主题包与想法种子
```

`.codebuddy/skills/weread-skills/` 保存微信读书 API 的接口说明；`.weread-sync/scripts/` 提供同步、Markdown 转换和知识库校验脚本；`dsh/` 把笔记和知识库接进 DeepSeek Harness（问答和整理两个模式）。

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

详细说明见 [知识库说明](kb/README.md) 和 [.weread-sync 使用说明](.weread-sync/README.md)。

## 在 DeepSeek Harness 里使用

`dsh/` 是一个 DeepSeek Harness（DSH）插件，给 DSH 加两个模式：

- **读书问答模式**：基于笔记回答问题（查概念、找做法、梳理主题、比较几本书），每个要点标出是哪本书、哪张卡片；还没整理的书直接查原始划线和想法。只读。
- **读书整理模式**：把原始笔记整理成卡片：选书、读原始笔记、查重、按模板写卡片、建立来源链路、校验。会话目录选本仓库。

```powershell
npm install -g @deepseek-ai/dsh@0.2.0-rc.2       # 还没装 DSH 时
.\dsh\scripts\install-dadventures.ps1            # 装进名为 dadventures 的 DSH Profile
dsh --profile dadventures --port 3091
```

同一套工具也能在终端里直接用，需要 Node.js 24 以上，不需要 `npm install`：

```powershell
npm run kb:check                                 # 校验知识库（规则与 validate_knowledge.py 相同，另有提醒）
npm run kb -- search 安全感 --intent concept      # 搜卡片
npm run kb -- books --stage pending              # 哪些书还没整理
npm test
```

安装选项、工具列表和检索方式见 [dsh/README.md](dsh/README.md)。

## 个人数据提醒

`.weread-sync/raw_notes/` 和 `notes/` 含个人阅读数据，当前会随 Git 仓库跟踪。分享或公开仓库前请检查可见范围；添加 `.gitignore` 不会移除已跟踪文件或 Git 历史中的内容。
