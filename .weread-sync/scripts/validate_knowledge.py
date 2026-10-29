#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Validate Markdown knowledge-card metadata and internal references."""

import argparse
import re
import sys
from pathlib import Path


WORKSPACE = (
    Path(__file__).resolve().parents[2]
    / "微信读书知识库"
    / "openclaw"
    / "workspace"
)
CONTROLLED_FIELDS = {
    "subject_domains": "Subject Domains",
    "note_kind": "Note Kinds",
    "concept_type": "Concept Types",
    "action_type": "Action Types",
    "claim_basis": "Claim Basis",
    "audiences": "Audiences",
    "use_cases": "Use Cases",
    "effort": "Effort",
    "time_horizon": "Time Horizon",
    "collection_kind": "Collection Kinds",
    "idea_kind": "Idea Kinds",
    "status": "Status",
}
REFERENCE_FIELDS = {
    "source_book",
    "source_refs",
    "derived_cards",
    "related_actions",
    "related_concepts",
    "theme_refs",
    "included_cards",
}
DOC_TYPES = {
    "source_book",
    "source_note",
    "concept_card",
    "action_card",
    "collection",
    "idea_seed",
}
ID_PREFIXES = {
    "source_book": "book",
    "source_note": "note",
    "concept_card": "concept",
    "action_card": "action",
    "collection": "collection",
    "idea_seed": "idea",
}


def unquote(value):
    value = value.strip().rstrip(",")
    if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
        return value[1:-1]
    return value


def parse_frontmatter(text):
    match = re.match(r"\A---\s*\r?\n(.*?)\r?\n---(?:\s*\r?\n|\Z)", text, re.S)
    if not match:
        return None

    fields = {}
    current_key = None
    for line in match.group(1).splitlines():
        key_match = re.match(r"^([A-Za-z_][A-Za-z0-9_-]*):(?:\s*(.*))?$", line)
        if key_match:
            current_key = key_match.group(1)
            raw_value = (key_match.group(2) or "").strip()
            if raw_value.startswith("[") and raw_value.endswith("]"):
                fields[current_key] = [
                    unquote(item) for item in raw_value[1:-1].split(",") if item.strip()
                ]
            elif raw_value:
                fields[current_key] = unquote(raw_value)
            else:
                fields[current_key] = []
            continue
        if current_key and isinstance(fields.get(current_key), list):
            item_match = re.match(r"^\s+-\s+(.+?)\s*$", line)
            if item_match:
                fields[current_key].append(unquote(item_match.group(1)))
    return fields


def parse_taxonomy(text):
    sections = {}
    current_section = None
    for line in text.splitlines():
        heading = re.match(r"^##\s+(.+?)\s*$", line)
        if heading:
            current_section = heading.group(1)
            sections[current_section] = set()
        elif current_section:
            item = re.match(r"^\s*-\s+`([^`]+)`", line)
            if item:
                sections[current_section].add(item.group(1))
    return sections


def markdown_files(root):
    content_roots = (
        "sources/books",
        "sources/notes",
        "concepts",
        "actions",
        "collections",
        "ideas",
    )
    for relative_root in content_roots:
        content_root = root / relative_root
        if content_root.exists():
            yield from content_root.rglob("*.md")


def subject_scope(relative_path):
    parts = relative_path.parts
    return parts[2] if parts[0] == "sources" and len(parts) > 2 else parts[1]


def validate(root=WORKSPACE, strict_taxonomy=False):
    errors = []
    taxonomy_path = root / "taxonomy" / "taxonomy.md"
    if not taxonomy_path.exists():
        return [f"{taxonomy_path}: taxonomy file is missing"]
    taxonomy = parse_taxonomy(taxonomy_path.read_text(encoding="utf-8"))
    documents = []

    for path in markdown_files(root):
        try:
            text = path.read_text(encoding="utf-8")
        except (OSError, UnicodeError) as exc:
            errors.append(f"{path}: cannot read file ({exc})")
            continue
        fields = parse_frontmatter(text)
        if fields is None:
            errors.append(f"{path}: missing or malformed YAML frontmatter")
            continue
        relative = path.relative_to(root)
        for required in ("doc_type", "id", "status"):
            if not fields.get(required):
                errors.append(f"{relative}: missing required field '{required}'")
        if fields.get("doc_type") and fields["doc_type"] not in DOC_TYPES:
            errors.append(f"{relative}: unknown doc_type '{fields['doc_type']}'")
        if fields.get("schema_version") == "2":
            prefix = ID_PREFIXES.get(fields.get("doc_type"))
            record_id = fields.get("id", "")
            if prefix and not re.fullmatch(
                rf"{prefix}-[a-z0-9]+(?:_[a-z0-9]+)*-\d{{4}}", record_id
            ):
                errors.append(
                    f"{relative}: schema_version 2 ID must use '{prefix}-<subject>-<number>'"
                )
        title = fields.get("title", "")
        if isinstance(title, str) and title.startswith("fill_in_"):
            errors.append(f"{relative}: title still contains a template placeholder")
        if strict_taxonomy or fields.get("schema_version") == "2":
            for field, section in CONTROLLED_FIELDS.items():
                values = fields.get(field, [])
                if isinstance(values, str):
                    values = [values]
                allowed = taxonomy.get(section, set())
                for value in values:
                    if value not in allowed:
                        errors.append(
                            f"{relative}: {field} value '{value}' is not in taxonomy section '{section}'"
                        )
        documents.append((relative, fields))

    id_to_paths = {}
    for path, fields in documents:
        record_id = fields.get("id")
        if not record_id:
            continue
        scope = subject_scope(path)
        key = (scope, record_id)
        if key in id_to_paths:
            errors.append(
                f"{path}: duplicate id '{record_id}' in subject '{scope}' also used by {id_to_paths[key]}"
            )
        else:
            id_to_paths[key] = path

    candidates = {}
    for (scope, record_id), path in id_to_paths.items():
        candidates.setdefault(record_id, []).append((scope, path))
    for path, fields in documents:
        for field in REFERENCE_FIELDS:
            references = fields.get(field, [])
            if isinstance(references, str):
                references = [references]
            for reference in references:
                if not reference or (
                    field == "source_book" and reference == "manual_synthesis"
                ):
                    continue
                matches = candidates.get(reference, [])
                local_matches = [
                    match for match in matches if match[0] == subject_scope(path)
                ]
                if not matches:
                    errors.append(
                        f"{path}: {field} references unknown id '{reference}'"
                    )
                elif len(local_matches) > 1 or (not local_matches and len(matches) > 1):
                    errors.append(
                        f"{path}: {field} reference '{reference}' is ambiguous across subject domains"
                    )
    return errors


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--strict-taxonomy",
        action="store_true",
        help="also validate legacy records against current taxonomy values",
    )
    args = parser.parse_args()
    problems = validate(strict_taxonomy=args.strict_taxonomy)
    if problems:
        for problem in problems:
            print(f"ERROR: {problem}", file=sys.stderr)
        print(f"Found {len(problems)} knowledge-base issue(s).", file=sys.stderr)
        raise SystemExit(1)
    print("Knowledge-base metadata and references are valid.")
