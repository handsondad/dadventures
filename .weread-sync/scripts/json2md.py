#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Convert synchronized WeRead JSON into a Markdown reading archive."""
import json
import re
from pathlib import Path
from datetime import datetime
from urllib.parse import urlencode

BASE = Path(__file__).resolve().parents[1] / "raw_notes"
OUT = Path(__file__).resolve().parents[2] / "微信读书笔记"

def format_time(ts):
    """Unix时间戳转 YYYY/MM/DD"""
    if not ts:
        return ""
    return datetime.fromtimestamp(int(ts)).strftime('%Y/%m/%d')


def weread_link(book_id, chapter_uid=0, note_range=""):
    """Build a WeRead deep link when the source provides enough location data."""
    params = {"bookId": book_id}
    match = re.fullmatch(r"(\d+)-(\d+)", str(note_range or ""))
    if chapter_uid and match:
        params.update(
            chapterUid=chapter_uid,
            rangeStart=match.group(1),
            rangeEnd=match.group(2),
        )
        return "weread://bestbookmark?" + urlencode(params)
    if chapter_uid:
        return "weread://reading?" + urlencode(
            {"bId": book_id, "chapterUid": chapter_uid}
        )
    return "weread://reading?" + urlencode({"bId": book_id})


def source_locator(item, book_id):
    details = []
    if item.get("reviewId"):
        details.append(f"reviewId: `{item['reviewId']}`")
    if item.get("bookmarkId"):
        details.append(f"bookmarkId: `{item['bookmarkId']}`")
    if item.get("chapterUid"):
        details.append(f"chapterUid: `{item['chapterUid']}`")
    if item.get("range"):
        details.append(f"range: `{item['range']}`")
    if details:
        details.append(f"[在微信读书打开]({weread_link(book_id, item.get('chapterUid'), item.get('range'))})")
    return "；".join(details)

def convert_to_md(book_dir, category_dir):
    """将一本书的JSON转为MD"""
    raw_file = book_dir / "raw.json"
    if not raw_file.exists():
        print(f"  [跳过] {book_dir.name} - 无raw.json")
        return False
    
    with open(raw_file, encoding='utf-8') as f:
        data = json.load(f)
    
    title = data.get('title', book_dir.name)
    author = data.get('author', '')
    reviews = data.get('reviews', [])
    marks = data.get('marks', [])
    
    if not reviews and not marks:
        print(f"  [跳过] {title} - 无笔记")
        return False
    
    # 按章节分组
    chapters = {}
    no_chapter = []  # 整书点评
    
    for r in reviews:
        ch_name = r.get('chapterName', '').strip()
        content = r.get('content', '').strip()
        abstract = r.get('abstract', '').strip()
        create_time = r.get('createTime', 0)
        
        item = {
            'reviewId': r.get('reviewId', ''),
            'content': content,
            'abstract': abstract,
            'time': format_time(create_time),
            'ts': create_time,
            'chapterUid': r.get('chapterUid', 0),
            'range': r.get('range', ''),
        }
        
        if ch_name:
            if ch_name not in chapters:
                chapters[ch_name] = []
            chapters[ch_name].append(item)
        else:
            no_chapter.append(item)
    
    # 生成MD内容
    md_lines = []
    md_lines.append(f"《{title}》")
    md_lines.append(f"\n{author}")
    md_lines.append(f"\n微信读书 bookId：`{data.get('bookId', '')}`")
    md_lines.append(
        f"\n{len(marks)} 条划线，{len(reviews)} 条想法/点评"
        f"（同步时间：{format_time(data.get('fetchedAt', 0)) or '未知'}）\n"
    )
    
    # 整书点评放最前面
    if no_chapter:
        md_lines.append("点评\n")
        for item in sorted(no_chapter, key=lambda x: x['ts'], reverse=True):
            if item['content']:
                md_lines.append(f"\n◆ {item['time']}发表想法\n")
                md_lines.append(f"\n{item['content']}\n")
                locator = source_locator(item, data.get('bookId', ''))
                if locator:
                    md_lines.append(f"\n来源定位：{locator}\n")
                # 如果content是abstract的摘录，追加完整abstract
                if item['abstract'] and item['abstract'] != item['content']:
                    md_lines.append(f"\n原文：{item['abstract']}\n")
            elif item['abstract']:
                md_lines.append(f"\n原文：{item['abstract']}\n")
                locator = source_locator(item, data.get('bookId', ''))
                if locator:
                    md_lines.append(f"\n来源定位：{locator}\n")
    
    # 按章节输出
    for ch_name, items in sorted(chapters.items()):
        md_lines.append(f"\n{ch_name}\n")
        for item in sorted(items, key=lambda x: x['ts'], reverse=True):
            if item['content']:
                md_lines.append(f"\n◆ {item['time']}发表想法\n")
                md_lines.append(f"\n{item['content']}\n")
                locator = source_locator(item, data.get('bookId', ''))
                if locator:
                    md_lines.append(f"\n来源定位：{locator}\n")
                # 如果content是abstract的摘录，追加完整abstract
                if item['abstract'] and item['abstract'] != item['content']:
                    md_lines.append(f"\n原文：{item['abstract']}\n")
            elif item['abstract']:
                md_lines.append(f"\n◆ {item['abstract']}\n")
                locator = source_locator(item, data.get('bookId', ''))
                if locator:
                    md_lines.append(f"\n来源定位：{locator}\n")

    if marks:
        md_lines.append("\n划线\n")
        for mark in sorted(marks, key=lambda x: x.get('createTime', 0), reverse=True):
            chapter_name = mark.get('chapterName') or "未标注章节"
            md_lines.append(f"\n### {chapter_name}\n")
            md_lines.append(f"\n> {mark.get('markText', '').strip()}\n")
            created = format_time(mark.get('createTime', 0))
            if created:
                md_lines.append(f"\n划线时间：{created}")
            locator = source_locator(mark, data.get('bookId', ''))
            if locator:
                md_lines.append(f"\n来源定位：{locator}")
            md_lines.append("")
    
    # 保存MD
    out_dir = OUT / category_dir
    out_dir.mkdir(parents=True, exist_ok=True)
    
    # 清理书名中的非法字符
    safe_name = re.sub(r'[<>:"/\\|?*]', '-', title)
    md_file = out_dir / f"{safe_name}.md"
    
    with open(md_file, 'w', encoding='utf-8') as f:
        f.write('\n'.join(md_lines))
    
    print(f"  [生成] {md_file.name}")
    return True

def main():
    import sys
    
    if len(sys.argv) > 1:
        # 指定书名转换
        book_name = sys.argv[1]
        book_dir = BASE / book_name
        if book_dir.exists():
            convert_to_md(book_dir, "未分类")
        else:
            print(f"找不到: {book_dir}")
        return
    
    # 转换全部
    print("="*50)
    print("  微信读书笔记 JSON -> MD")
    print("="*50)
    print(f"\n源: {BASE}")
    print(f"目标: {OUT}\n")
    
    count = 0
    for book_dir in sorted(BASE.iterdir()):
        if book_dir.is_dir():
            if convert_to_md(book_dir, "未分类"):
                count += 1
    
    print(f"\n完成! 转换 {count} 本书")
    print(f"保存到: {OUT}")

if __name__ == "__main__":
    main()
