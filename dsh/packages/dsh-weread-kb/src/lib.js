// Plain functions for scripts and other packages (no DSH needed): `@dadventures/dsh-weread-kb/lib`.
export { createKnowledgeIndex, nextId } from './index.js';
export { checkKnowledge } from './check.js';
export { parseFrontmatter } from './frontmatter.js';
export { DOC_TYPES, INTENTS, parseTaxonomy, repoPaths } from './layout.js';
export { normalize, queryTerms, rank, snippet, squash } from './search.js';
export { createKbService, kbServiceOf } from './service.js';
export { createSourceIndex, parseArchive, parseRaw, wereadLink } from './sources.js';
export { ANSWER_SKILLS, MAINTENANCE_SKILLS, loadRuleSkills } from './skills.js';
export { createKbTools } from './tools.js';
export { KB_SERVICE, repoRootOf } from './shared.js';
