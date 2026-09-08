import { createCore } from './core.mjs';
import { loadStorage } from './storage.mjs';
import { loadPipeline } from './pipeline.mjs';

export async function dispatch(operation, request, params, env) {
  const storage = await loadStorage();
  // Read-only routes never load the news input engine or generation services.
  const pipeline = operation === 'news' || operation === 'jobs' ? await loadPipeline({ env }) : null;
  return createCore({ storage, pipeline }).dispatch(operation, request, params, env);
}
