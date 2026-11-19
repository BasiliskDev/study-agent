-- Full-text index over course material text, used by the agent's search_materials tool.
-- Kept in sync by lib/sync.ts (delete + insert per material), not by triggers.
CREATE VIRTUAL TABLE `materials_fts` USING fts5(
  `material_id` UNINDEXED,
  `course_id` UNINDEXED,
  `title`,
  `body`,
  tokenize = 'porter unicode61'
);
