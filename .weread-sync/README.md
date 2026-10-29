# 微信读书同步与整理工具

此目录保存微信读书 API 返回的个人笔记原始数据。同步结果包括个人划线与想法/点评；书签目前只记录数量，不导出书签内容。

## 目录结构

```text
.weread-sync/
  scripts/
    sync_final.py       # 唯一同步入口：分页拉取笔记本、划线和想法
    json2md.py          # 将原始 JSON 转成按书归档的 Markdown
    validate_knowledge.py
  raw_notes/            # 原始 JSON，按书分目录
  state/
    sync_state.json     # 每本书的计数、排序游标和同步时间
```

## 同步

需要 Python 3 和 `requests`。在 PowerShell 中设置 API Key：

```powershell
$env:WEREAD_API_KEY = "你的微信读书 API Key"
python .weread-sync\scripts\sync_final.py
```

也可在 `~/.codebuddy/.env` 中设置 `WEREAD_API_KEY`，供本机使用。不要把密钥写入仓库文件。

脚本会完整分页读取有笔记的书籍列表，检查有变化的书，并同步划线及想法/点评。失败的书会显示错误，进程返回非零退出码；成功书籍的结果仍会保存，失败书籍下次仍可重试。API 的 `upgrade_info` 会中止同步并显示服务端升级提示。

## 转换与知识整理

```powershell
python .weread-sync\scripts\json2md.py
```

转换结果写入 `微信读书笔记/未分类/`，包含微信读书 `bookId`、笔记 ID、章节/range 和可用的 `weread://` 定位链接。随后人工审核并按知识库工作流整理，不要把原始导出直接当成最终概念卡或行动卡。

单独转换一本书时，传入它在 `raw_notes/` 下的目录名：

```powershell
python .weread-sync\scripts\json2md.py "书目录名"
```

## 数据范围与保护

- `raw_notes/<书目录>/raw.json` 是完整同步归档；转换脚本生成的 Markdown 是方便阅读的副本。
- 微信读书书架接口返回的个人划线由 `/book/bookmarklist` 获取；想法/点评由 `/review/list/mine` 获取。
- 不导出书签内容；状态中保留 API 提供的书签数量。
- 仓库当前跟踪这些个人笔记数据。请确认仓库访问权限和备份策略符合预期；不要只靠新增 ignore 规则处理已跟踪数据。
