---
doc_type: concept_card
id: concept-0011
title: thresholds-must-be-updated-by-drift-signals-not-frozen-at-initial-settings
title_zh: 阈值要由漂移信号持续更新 不能冻结在初始设定
status: draft
language: zh-CN
subject_domains:
  - chemistry
  - engineering
  - methodology
topic_tags:
  - threshold_drift_monitoring
  - recalibration
  - durability_governance
  - signal_based_control
scenes:
  - materials_science
  - maintenance
  - infrastructure
problems:
  - why_initial_thresholds_fail_in_long_term_use
  - how_to_convert_drift_signals_into_operational_recalibration
idea_sparks:
  - stable_durability_requires_threshold_recalibration_not_once_only_configuration
concept_type: principle
claim_basis: personal_summary
source_refs:
  - note-0006
related_actions:
  - action-0006
aliases:
  - 阈值漂移重标原则
search_terms:
  - 阈值 漂移 更新
  - 重标 维护
last_reviewed: 2026-04-02
---

# 核心定义

阈值不是一次设定后永久有效的常量，而是需要根据材料状态、环境暴露和事件反馈持续重标的控制变量。

## 关键点

- 初始阈值只代表起点，不代表长期稳定状态。
- 漂移信号应进入常规维护，而不是只在失效后追认。
- 阈值重标要和场景、机制、代价一起更新。

## 来源说明

- 来源笔记 ID: note-0006
