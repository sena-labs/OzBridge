import { IOzCliService } from '../types/index.js';

/**
 * Fetches the list of available Oz model ids via `oz model list`.
 *
 * Pure-ish helper shared by every model-selection surface (VS Code QuickPick,
 * the `@oz /models` slash command, and the `oz_list_models` MCP tool) so the
 * id extraction stays consistent. Returns a de-duplicated, order-preserving
 * array of non-empty string ids.
 */
export async function fetchModelIds(cli: IOzCliService): Promise<string[]> {
  const list = await cli.modelList();
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const m of list.items) {
    const id = (m as { id?: unknown }).id;
    if (typeof id === 'string' && id.length > 0 && !seen.has(id)) {
      seen.add(id);
      ids.push(id);
    }
  }
  return ids;
}
