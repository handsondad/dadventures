import { createKbService } from './service.js';
import { KB_SERVICE } from './shared.js';

// 读书知识库配置: the host row. It holds repoRoot and provides the shared service, so 读书整理模式, 读书问答模式
// and any mode added later read the same repository.
export const name = 'weread-kb';

export function apply(ctx, config = {}) {
  ctx.provide(KB_SERVICE, createKbService(config));
}
