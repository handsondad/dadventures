import importlib.util
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch


ROOT = Path(__file__).resolve().parents[2]
SCRIPTS = ROOT / ".weread-sync" / "scripts"


def load_module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


sync = load_module("weread_sync", SCRIPTS / "sync_final.py")
converter = load_module("weread_json2md", SCRIPTS / "json2md.py")
validator = load_module("knowledge_validator", SCRIPTS / "validate_knowledge.py")


class SyncTests(unittest.TestCase):
    def test_api_uses_supplied_key_and_reports_service_errors(self):
        response = Mock()
        response.json.return_value = {"ok": True}
        with patch.object(sync.requests, "post", return_value=response) as post:
            self.assertEqual(sync.api("/test", api_key="test-key"), {"ok": True})

        self.assertEqual(post.call_args.kwargs["headers"]["Authorization"], "test-key")
        self.assertEqual(post.call_args.kwargs["json"]["skill_version"], "1.0.3")

        response.json.return_value = {"errcode": 7, "errmsg": "denied"}
        with patch.object(sync.requests, "post", return_value=response):
            with self.assertRaisesRegex(RuntimeError, "denied"):
                sync.api("/test", api_key="test-key")

    def test_script_paths_are_relative_to_the_repository(self):
        self.assertEqual(sync.BASE, ROOT / ".weread-sync")
        self.assertEqual(converter.OUT, ROOT / "微信读书笔记")

    def test_book_directory_does_not_reuse_a_colliding_title(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            with patch.object(sync, "RAW", Path(temp_dir)):
                (Path(temp_dir) / "同名书").mkdir()
                (Path(temp_dir) / "同名书--book-2").mkdir()
                result = sync.book_directory("同名书", "book-2", {})

        self.assertEqual(result.name, "同名书--book-2-2")

    def test_notebook_pagination_uses_last_sort(self):
        pages = [
            {"books": [{"bookId": "a", "sort": 20}], "hasMore": 1},
            {"books": [{"bookId": "b", "sort": 10}], "hasMore": 0},
        ]
        calls = []

        def fake_api(name, params):
            calls.append((name, params))
            return pages.pop(0)

        with patch.object(sync.time, "sleep"):
            result = sync.fetch_notebooks(fake_api)

        self.assertEqual([book["bookId"] for book in result], ["a", "b"])
        self.assertEqual(calls[0][1], {"count": 100})
        self.assertEqual(calls[1][1], {"count": 100, "lastSort": 20})

    def test_notebook_pagination_rejects_repeated_cursor(self):
        def fake_api(_name, _params):
            return {"books": [{"bookId": "a", "sort": 20}], "hasMore": 1}

        with patch.object(sync.time, "sleep"):
            with self.assertRaisesRegex(RuntimeError, "游标重复"):
                sync.fetch_notebooks(fake_api)

    def test_review_pagination_deduplicates_by_review_id(self):
        pages = [
            {
                "reviews": [{"review": {"reviewId": "r1", "content": "first"}}],
                "hasMore": 1,
                "synckey": 8,
            },
            {
                "reviews": [
                    {"review": {"reviewId": "r1", "content": "updated"}},
                    {"review": {"reviewId": "r2", "content": "second"}},
                ],
                "hasMore": 0,
            },
        ]

        def fake_api(_name, _params):
            return pages.pop(0)

        with patch.object(sync.time, "sleep"):
            result = sync.fetch_reviews("book1", fake_api)

        self.assertEqual(len(result), 2)
        self.assertEqual(sync.normalize_review(result[0])["content"], "updated")

    def test_raw_converter_preserves_source_ids_and_deep_links(self):
        raw_data = {
            "bookId": "book-1",
            "title": "测试书",
            "author": "作者",
            "fetchedAt": 1770000000,
            "reviews": [
                {
                    "reviewId": "review-1",
                    "content": "我的想法",
                    "chapterName": "第一章",
                    "chapterUid": 3,
                    "range": "100-120",
                    "createTime": 1770000000,
                }
            ],
            "marks": [
                {
                    "bookmarkId": "mark-1",
                    "markText": "划线原文",
                    "chapterName": "第一章",
                    "chapterUid": 3,
                    "range": "100-120",
                    "createTime": 1770000000,
                }
            ],
        }
        with tempfile.TemporaryDirectory() as temp_dir:
            book_dir = Path(temp_dir) / "raw"
            book_dir.mkdir()
            (book_dir / "raw.json").write_text(
                json.dumps(raw_data, ensure_ascii=False), encoding="utf-8"
            )
            output_dir = Path(temp_dir) / "output"
            with patch.object(converter, "OUT", output_dir):
                self.assertTrue(converter.convert_to_md(book_dir, "未分类"))
                markdown = (output_dir / "未分类" / "测试书.md").read_text(
                    encoding="utf-8"
                )

        self.assertIn("reviewId: `review-1`", markdown)
        self.assertIn("bookmarkId: `mark-1`", markdown)
        self.assertIn("划线原文", markdown)
        self.assertIn("weread://bestbookmark?", markdown)


class KnowledgeValidatorTests(unittest.TestCase):
    def test_repository_has_valid_metadata_and_references(self):
        self.assertEqual(validator.validate(), [])

    def test_frontmatter_parser_reads_scalar_and_list_values(self):
        fields = validator.parse_frontmatter(
            "---\ndoc_type: concept_card\nstatus: draft\n"
            "source_refs:\n  - note-demo\n---\n"
        )
        self.assertEqual(fields["status"], "draft")
        self.assertEqual(fields["source_refs"], ["note-demo"])

    def test_schema_v2_rejects_taxonomy_drift(self):
        taxonomy = """## Action Types
- `decision_rule`

## Status
- `draft`
"""
        record = """---
doc_type: action_card
schema_version: 2
id: action-investing-0001
status: draft
action_type: research_method
---
"""
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            (root / "taxonomy").mkdir()
            (root / "taxonomy" / "taxonomy.md").write_text(
                taxonomy, encoding="utf-8"
            )
            card_dir = root / "actions" / "investing"
            card_dir.mkdir(parents=True)
            card_path = card_dir / "action-investing-0001.md"
            card_path.write_text(record, encoding="utf-8")

            issues = validator.validate(root)

        self.assertEqual(len(issues), 1)
        self.assertIn("action_type value 'research_method'", issues[0])


if __name__ == "__main__":
    unittest.main()
