# 使用指南

## 1. 同步微信读书

```powershell
$env:WEREAD_API_KEY = "你的微信读书 API Key"
python .weread-sync\scripts\sync_final.py
```

同步脚本从环境变量读取 `WEREAD_API_KEY`；也兼容本机 `~/.codebuddy/.env`。同步接口错误会显示在终端；只要有书籍失败，脚本就以非零状态结束，便于重试和自动化检测。

## 2. 转换为 Markdown 阅读档案

```powershell
python .weread-sync\scripts\json2md.py
```

输出位于 `notes/未分类/`。脚本保留划线、想法/点评、微信读书条目 ID、章节位置和可生成的 App 深链接。

## 3. 整理到知识库

根据 `kb/IDEA_CAPTURE_WORKFLOW.md`，先建立来源书目和来源笔记，再视需要拆成概念卡、行动卡、主题包或想法种子。请区分书中主张、个人转述和个人判断，并保留可回溯的来源线索。

## 4. 校验知识库

```powershell
python .weread-sync\scripts\validate_knowledge.py
```

脚本检查知识条目的 frontmatter、文档类型、ID 冲突和失效内部引用。新建条目应遵循模板中的 `schema_version: 2`，其受控词值会按 taxonomy 检查。可选参数 `--strict-taxonomy` 可审计旧条目的词表漂移；现存旧条目尚未全部迁移，报告可能包含历史不一致。

## 注意

- 微信读书笔记原始 JSON 和 Markdown 阅读档案属于个人数据；仓库当前跟踪它们。
- API 的书签内容目前不可导出，只有书签数量可用。
- 脚本位置和输出目录均相对于仓库计算，不依赖某台电脑的固定绝对路径。
