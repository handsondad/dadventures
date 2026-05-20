# WeRead Sync - 微信读书笔记提取工具

## 功能

从微信读书API提取**阅读中有笔记的书籍**，保存原始笔记数据。

## 目录结构

```
.weread-sync/
├── sync_final.py     # 同步脚本（唯一）
├── raw_notes/        # 提取的原始笔记（按书名分目录）
│   ├── 书名A/
│   │   └── raw.json
│   └── 书名B/
│       └── raw.json
└── state/
    └── done.json     # 已同步记录（下次跳过）
```

## 使用方式

告诉我：**"抽取最新微信读书笔记"**

或者手动运行：
```powershell
cd d:/xiuqinCode/xiuqin/dadventures/.weread-sync/scripts
python sync_final.py
```

## 工作流程

```
微信读书API
    ↓
sync_final.py (提取阅读中的书)
    ↓
raw_notes/ (每本书一个目录，存raw.json)
    ↓
用户审核后手动加工到知识库
```

## raw.json 数据格式

```json
{
  "bookId": "3300053592",
  "title": "书名",
  "author": "作者",
  "noteCount": 5,
  "marks": [
    {
      "markText": "划线内容",
      "chapterIdx": 1,
      "createTime": 1700000000
    }
  ]
}
```

## 特性

- **增量同步**：已处理的书籍自动跳过
- **只提取阅读中**：不包括已读完（已手动导出）
- **不污染知识库**：笔记先到这里，用户审核后再加工
