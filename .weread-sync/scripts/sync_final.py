#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""微信读书笔记同步 - 想法+原文（对应格式）"""
import os, sys, json, time, requests, re
from pathlib import Path

BASE = Path(r"d:\xiuqinCode\xiuqin\dadventures\.weread-sync")
RAW = BASE / "raw_notes"
STATE = BASE / "state"
RAW.mkdir(parents=True, exist_ok=True)
STATE.mkdir(parents=True, exist_ok=True)

def get_key():
    p = Path(os.environ['USERPROFILE']) / '.codebuddy' / '.env'
    for line in p.read_text(encoding='utf-8').splitlines():
        if 'WEREAD_API_KEY' in line: return line.split('=',1)[1].strip()

def api(name, params=None):
    body = {"api_name":name,"skill_version":"1.0.3"}
    if params: body.update(params)
    r = requests.post('https://i.weread.qq.com/api/agent/gateway',
        headers={"Authorization":f"Bearer {get_key()}","Content-Type":"application/json"},
        json=body, timeout=30)
    return r.json()

def slug(title):
    return re.sub(r'[^\u4e00-\u9fa5a-zA-Z0-9]', '-', title)[:50]

# 加载同步状态
def load_state():
    f = STATE / "sync_state.json"
    if f.exists():
        try: return json.loads(f.read_text(encoding='utf-8'))
        except: pass
    return {"last_sync": 0, "books": {}}

def save_state(state):
    (STATE / "sync_state.json").write_text(json.dumps(state, ensure_ascii=False), encoding='utf-8')

print("="*50)
print("  微信读书笔记提取（想法+原文）")
print("="*50)

current_ts = int(time.time())
state = load_state()
last_sync = state.get("last_sync", 0)
book_states = state.get("books", {})

print(f"\n上次同步: {time.strftime('%Y-%m-%d %H:%M:%S', time.localtime(last_sync)) if last_sync else '首次同步'}")

# 获取有笔记的书籍
print("\n[1] 获取有笔记的书籍...")
nb_data = api("/user/notebooks", {"count":100})
nb_books = nb_data.get('books', [])
print(f"    有笔记: {len(nb_books)} 本")

# 获取书架信息
print("[2] 获取书架信息...")
shelf = api("/shelf/sync")
shelf_books = {b['bookId']: b for b in shelf.get('books', [])}

new_books = 0
new_notes = 0
updated_books = 0

for nb in nb_books:
    bid = nb['bookId']
    local_state = book_states.get(bid, {})
    local_count = local_state.get("reviewCount", 0)
    remote_count = nb.get('reviewCount', 0)
    
    # 检查是否有新想法
    if remote_count <= local_count:
        continue
    
    # 获取书籍信息
    book = shelf_books.get(bid, {})
    title = book.get('title', nb.get('book', {}).get('title', f'book_{bid}'))
    author = book.get('author', nb.get('book', {}).get('author', ''))
    
    print(f"\n[3] {title}")
    print(f"    想法: {remote_count} 条")
    
    try:
        # 获取想法（分页）- 每条包含想法+原文
        all_reviews = []
        synckey = 0
        while True:
            resp = api("/review/list/mine", {"bookid": bid, "count": 100, "synckey": synckey})
            page_reviews = resp.get('reviews', [])
            all_reviews.extend(page_reviews)
            if not page_reviews or resp.get('hasMore') != 1:
                break
            synckey = resp.get('synckey', synckey + 1)
            time.sleep(0.1)
        
        print(f"    获取想法: {len(all_reviews)} 条")
        
        # 读取已有的数据
        bs = slug(title)
        bd = RAW / bs
        bd.mkdir(exist_ok=True)
        old_file = bd / "raw.json"
        existing_reviews = []
        if old_file.exists():
            old_data = json.loads(old_file.read_text(encoding='utf-8'))
            existing_reviews = old_data.get('reviews', [])
        
        # 合并想法（按createTime去重）
        all_rev = {r.get('review', {}).get('reviewId'): r for r in existing_reviews}
        for r in all_reviews:
            rid = r.get('review', {}).get('reviewId', '')
            if rid:
                all_rev[rid] = r
        all_reviews_list = list(all_rev.values())
        all_reviews_list.sort(key=lambda x: x.get('review', {}).get('createTime', 0), reverse=True)
        
        # 保存：每个review包含 content(想法) + abstract(原文) + chapterName + range
        raw_data = {
            "bookId": bid,
            "title": title,
            "author": author,
            "reviewCount": len(all_reviews_list),
            "reviews": [{
                "reviewId": r.get('review', {}).get('reviewId', ''),
                "content": r.get('review', {}).get('content', ''),      # 你的想法
                "abstract": r.get('review', {}).get('abstract', ''),    # 划线原文
                "chapterName": r.get('review', {}).get('chapterName', ''),  # 章节名
                "range": r.get('review', {}).get('range', ''),        # 划线位置
                "chapterUid": r.get('review', {}).get('chapterUid', 0),
                "createTime": r.get('review', {}).get('createTime', 0),
            } for r in all_reviews_list]
        }
        (bd / "raw.json").write_text(json.dumps(raw_data, ensure_ascii=False, indent=2), encoding='utf-8')
        
        # 更新状态
        book_states[bid] = {
            "reviewCount": len(all_reviews_list),
            "lastReviewTs": max([r.get('review', {}).get('createTime', 0) for r in all_reviews_list]) if all_reviews_list else 0
        }
        
        if local_count == 0:
            new_books += 1
            print(f"    -> 新增 {len(all_reviews_list)} 条")
        else:
            updated_books += 1
            print(f"    -> 更新: {local_count} -> {len(all_reviews_list)} 条")
        
        new_notes += remote_count - local_count
        
    except Exception as e:
        print(f"    -> 失败: {e}")
    
    time.sleep(0.1)

state["last_sync"] = current_ts
state["books"] = book_states
save_state(state)

print("\n" + "="*50)
print(f"完成! 新增 {new_books} 本, 更新 {updated_books} 本")
print(f"新增想法: {new_notes} 条")
print(f"保存位置: {RAW}")
print("="*50)
