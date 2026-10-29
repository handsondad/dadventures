#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Synchronize personal WeRead highlights and notes into a local raw archive."""

import json
import os
import re
import sys
import time
from pathlib import Path

import requests


BASE = Path(__file__).resolve().parents[1]
RAW = BASE / "raw_notes"
STATE = BASE / "state"
API_URL = "https://i.weread.qq.com/api/agent/gateway"
SKILL_VERSION = "1.0.3"
PAGE_SIZE = 100


def get_key():
    """Read the API key from the environment, with the legacy local .env as fallback."""
    key = os.environ.get("WEREAD_API_KEY", "").strip()
    if key:
        return key

    env_file = Path.home() / ".codebuddy" / ".env"
    if env_file.exists():
        for line in env_file.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if line.startswith("WEREAD_API_KEY="):
                key = line.split("=", 1)[1].strip().strip("\"'")
                if key:
                    return key
    raise RuntimeError(
        "未找到 WEREAD_API_KEY。请设置环境变量，或写入 ~/.codebuddy/.env。"
    )


def api(name, params=None, *, api_key=None):
    body = {"api_name": name, "skill_version": SKILL_VERSION}
    if params:
        body.update(params)
    response = requests.post(
        API_URL,
        headers={
            "Authorization": api_key or get_key(),
            "Content-Type": "application/json",
        },
        json=body,
        timeout=30,
    )
    response.raise_for_status()
    try:
        result = response.json()
    except ValueError as exc:
        raise RuntimeError(f"{name} 返回的不是有效 JSON") from exc
    if not isinstance(result, dict):
        raise RuntimeError(f"{name} 返回的数据格式无效")

    upgrade_info = result.get("upgrade_info")
    if upgrade_info:
        message = upgrade_info.get("message", "请先升级微信读书技能配置")
        raise RuntimeError(f"微信读书接口要求升级：{message}")
    errcode = result.get("errcode")
    if errcode not in (None, 0, "0"):
        raise RuntimeError(f"{name} 接口返回错误：{result.get('errmsg', errcode)}")
    return result


def has_more(page):
    return page.get("hasMore") in (1, "1", True)


def slug(title):
    value = re.sub(r"[^\u4e00-\u9fa5a-zA-Z0-9]+", "-", title).strip("-")
    return value[:50] or "untitled-book"


def load_state():
    path = STATE / "sync_state.json"
    if not path.exists():
        return {"last_sync": 0, "books": {}}
    try:
        state = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise RuntimeError(f"同步状态文件无法读取：{path}") from exc
    if not isinstance(state, dict) or not isinstance(state.get("books", {}), dict):
        raise RuntimeError(f"同步状态文件格式无效：{path}")
    state.setdefault("books", {})
    return state


def save_json(path, value):
    temp_path = path.with_suffix(path.suffix + ".tmp")
    temp_path.write_text(
        json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    temp_path.replace(path)


def fetch_notebooks(api_call):
    """Fetch all notebook pages using WeRead's lastSort cursor."""
    books = {}
    last_sort = None
    seen_cursors = set()

    while True:
        params = {"count": PAGE_SIZE}
        if last_sort is not None:
            params["lastSort"] = last_sort
        page = api_call("/user/notebooks", params)
        for book in page.get("books", []):
            book_id = book.get("bookId")
            if book_id:
                books[book_id] = book

        if not has_more(page):
            break
        page_books = page.get("books", [])
        if not page_books or page_books[-1].get("sort") is None:
            raise RuntimeError("笔记本分页标记为有下一页，但缺少 lastSort 游标")
        next_cursor = page_books[-1]["sort"]
        if next_cursor in seen_cursors or next_cursor == last_sort:
            raise RuntimeError("笔记本分页游标重复，已停止以避免重复请求")
        seen_cursors.add(next_cursor)
        last_sort = next_cursor
        time.sleep(0.1)

    return list(books.values())


def fetch_reviews(book_id, api_call):
    reviews = {}
    synckey = 0
    seen_cursors = set()

    while True:
        page = api_call(
            "/review/list/mine",
            {"bookid": book_id, "count": PAGE_SIZE, "synckey": synckey},
        )
        for item in page.get("reviews", []):
            review = item.get("review", item)
            review_id = review.get("reviewId") or item.get("reviewId")
            if review_id:
                reviews[str(review_id)] = item

        if not has_more(page):
            break
        next_cursor = page.get("synckey")
        if next_cursor is None or next_cursor == synckey or next_cursor in seen_cursors:
            raise RuntimeError(f"书籍 {book_id} 的想法分页游标无效")
        seen_cursors.add(next_cursor)
        synckey = next_cursor
        time.sleep(0.1)

    return list(reviews.values())


def normalize_review(item):
    review = item.get("review", item)
    return {
        "reviewId": str(review.get("reviewId") or item.get("reviewId") or ""),
        "content": review.get("content", ""),
        "abstract": review.get("abstract", ""),
        "chapterName": review.get("chapterName", ""),
        "chapterUid": review.get("chapterUid", 0),
        "range": review.get("range", ""),
        "createTime": review.get("createTime", 0),
        "star": review.get("star"),
        "isFinish": review.get("isFinish"),
    }


def normalize_mark(mark, chapter_by_uid):
    chapter_uid = mark.get("chapterUid", 0)
    chapter = chapter_by_uid.get(str(chapter_uid), {})
    return {
        "bookmarkId": str(mark.get("bookmarkId", "")),
        "markText": mark.get("markText", ""),
        "chapterUid": chapter_uid,
        "chapterIdx": chapter.get("chapterIdx", 0),
        "chapterName": chapter.get("title", ""),
        "range": mark.get("range", ""),
        "createTime": mark.get("createTime", 0),
        "colorStyle": mark.get("colorStyle"),
    }


def existing_book_directories():
    directories = {}
    for path in sorted(RAW.iterdir()):
        raw_path = path / "raw.json"
        if not path.is_dir() or not raw_path.exists():
            continue
        try:
            data = json.loads(raw_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue
        book_id = str(data.get("bookId", ""))
        if book_id:
            directories.setdefault(book_id, path)
    return directories


def book_directory(title, book_id, directory_index):
    existing = directory_index.get(str(book_id))
    if existing:
        return existing
    path = RAW / slug(title)
    if path.exists():
        path = RAW / f"{slug(title)}--{slug(str(book_id))}"
        suffix = 2
        while path.exists():
            path = RAW / f"{slug(title)}--{slug(str(book_id))}-{suffix}"
            suffix += 1
    return path


def should_sync(book, local_state, raw_path):
    if not raw_path.exists():
        return True
    return (
        book.get("reviewCount", 0) != local_state.get("reviewCount", 0)
        or book.get("noteCount", 0) != local_state.get("noteCount", 0)
        or book.get("sort", 0) > local_state.get("sort", 0)
    )


def sync():
    RAW.mkdir(parents=True, exist_ok=True)
    STATE.mkdir(parents=True, exist_ok=True)
    api_key = get_key()
    call_api = lambda name, params=None: api(name, params, api_key=api_key)

    state = load_state()
    book_states = state["books"]
    notebooks = fetch_notebooks(call_api)
    shelf = call_api("/shelf/sync")
    shelf_books = {
        str(book.get("bookId")): book for book in shelf.get("books", [])
    }
    directory_index = existing_book_directories()

    synced = 0
    skipped = 0
    failures = []
    now = int(time.time())
    print(f"发现 {len(notebooks)} 本有笔记的书")

    for notebook in notebooks:
        book_id = str(notebook.get("bookId", ""))
        if not book_id:
            continue
        local_state = book_states.get(book_id, {})
        shelf_book = shelf_books.get(book_id, {})
        notebook_book = notebook.get("book", {})
        title = shelf_book.get("title") or notebook_book.get("title") or f"book_{book_id}"
        author = shelf_book.get("author") or notebook_book.get("author", "")
        directory = book_directory(title, book_id, directory_index)
        raw_path = directory / "raw.json"

        if not should_sync(notebook, local_state, raw_path):
            skipped += 1
            continue

        try:
            reviews = [
                normalize_review(item) for item in fetch_reviews(book_id, call_api)
            ]
            bookmark_data = call_api("/book/bookmarklist", {"bookId": book_id})
            chapters = bookmark_data.get("chapters", [])
            chapter_by_uid = {
                str(chapter.get("chapterUid")): chapter
                for chapter in chapters
                if chapter.get("chapterUid") is not None
            }
            marks = [
                normalize_mark(mark, chapter_by_uid)
                for mark in bookmark_data.get("updated", [])
            ]
            marks.sort(key=lambda item: item.get("createTime", 0), reverse=True)
            reviews.sort(key=lambda item: item.get("createTime", 0), reverse=True)

            raw_data = {
                "sourcePlatform": "weread",
                "bookId": book_id,
                "title": title,
                "author": author,
                "fetchedAt": now,
                "reviewCount": len(reviews),
                "noteCount": len(marks),
                "bookmarkCount": notebook.get("bookmarkCount", 0),
                "chapters": chapters,
                "marks": marks,
                "reviews": reviews,
            }
            directory.mkdir(parents=True, exist_ok=True)
            save_json(raw_path, raw_data)
            directory_index[book_id] = directory
            book_states[book_id] = {
                "reviewCount": len(reviews),
                "noteCount": len(marks),
                "sort": notebook.get("sort", 0),
                "lastReviewTs": max(
                    (item.get("createTime", 0) for item in reviews), default=0
                ),
                "lastSync": now,
            }
            synced += 1
            print(f"[已同步] {title}：{len(marks)} 条划线，{len(reviews)} 条想法/点评")
        except (requests.RequestException, RuntimeError, OSError, ValueError) as exc:
            failures.append((title, str(exc)))
            print(f"[失败] {title}：{exc}", file=sys.stderr)
        time.sleep(0.1)

    state["books"] = book_states
    if not failures:
        state["last_sync"] = now
    save_json(STATE / "sync_state.json", state)
    print(f"同步 {synced} 本，跳过 {skipped} 本，失败 {len(failures)} 本")
    print(f"原始数据保存在：{RAW}")
    return 1 if failures else 0


if __name__ == "__main__":
    try:
        raise SystemExit(sync())
    except (requests.RequestException, RuntimeError, OSError) as exc:
        print(f"同步终止：{exc}", file=sys.stderr)
        raise SystemExit(1)
