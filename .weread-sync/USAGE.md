# WeRead Sync - 微信读书笔记同步工作流

## 使用方式

### 方式一：直接告诉 CodeBuddy（推荐）

只需对我说：
> "帮我抽取最新的微信读书笔记并完成知识库加工"

我会自动执行完整流程：
1. 从微信读书 API 提取新增笔记
2. 转换为知识库格式
3. 保存到 `微信读书知识库/openclaw/workspace/books/`

### 方式二：其他 Agent 调用

其他 Agent（如 workbuddy）可以通过以下方式触发：

1. **使用 PowerShell 脚本**：
   ```powershell
   cd d:/xiuqinCode/xiuqin/dadventures/.weread-sync/scripts
   .\Quick-Sync.ps1
   ```

2. **分步执行**：
   ```powershell
   # 提取笔记
   .\Sync-WeReadNotes.ps1
   # 处理为知识库
   .\Process-RawNotes.ps1 -All
   ```

### 方式三：手动运行菜单

```powershell
cd d:/xiuqinCode/xiuqin/dadventures/.weread-sync/scripts
.\Menu.ps1
```

## 脚本说明

| 脚本 | 功能 |
|------|------|
| Menu.ps1 | 主菜单入口 |
| Quick-Sync.ps1 | 快速增量同步 |
| Sync-WeReadNotes.ps1 | 提取笔记 |
| Process-RawNotes.ps1 | 处理原始笔记 |

## 工作流程

```
微信读书 API
    ↓
Sync-WeReadNotes.ps1 (提取笔记)
    ↓
.weread-sync/raw_notes/ (原始数据)
    ↓
Process-RawNotes.ps1 (处理转换)
    ↓
微信读书知识库/openclaw/workspace/books/ (知识库)
```

## 状态文件

- `state/sync_state.json` - 同步状态和时间戳
- `state/extracted_books.json` - 已提取书籍列表
- `state/failed_extracts.json` - 提取失败记录
- `processed/processed_records.json` - 已处理记录

## 注意事项

1. **API Key**: 确保设置了 `WEREAD_API_KEY` 环境变量
2. **增量同步**: 默认只同步阅读中的书籍（未读完）
3. **限流**: 脚本内置了限流，避免请求过快
4. **备份**: 处理前会保留原始笔记

## 故障排查

### 提取失败
- 检查网络连接
- 确认 API Key 有效
- 查看 logs 目录下的日志

### 笔记未更新
- 检查原始笔记文件是否存在
- 确认同步时间戳是否正确
