/**
 * Workspace configuration.
 * 
 * In Phase 3, this will be replaced by a workspace selector in the UI
 * and pulled from session/context. For now, all dashboard pages default
 * to dreamplay_marketing.
 */
export const DEFAULT_WORKSPACE = 'dreamplay_marketing' as const

export type WorkspaceType = 'dreamplay_marketing' | 'dreamplay_support' | 'musicalbasics' | 'crossover'
