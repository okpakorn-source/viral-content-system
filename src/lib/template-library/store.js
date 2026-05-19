import { readFile, writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { getSupabase, isSupabaseReady } from '@/lib/supabase';

/**
 * Template Library Store
 * Dual-source: Supabase (primary) → local file fallback
 * Schema: template JSON with slots[], canvas, effects[]
 */

const STORE_NAME = 'template-library';
const TABLE = 'store_items';
const LOCAL_PATH = join(process.cwd(), 'data', 'template-library.json');

// ── In-memory cache ─────────────────────────────────────────────
let _cache = null;

async function loadLocal() {
  if (_cache) return _cache;
  try {
    const raw = await readFile(LOCAL_PATH, 'utf-8');
    _cache = JSON.parse(raw);
    return _cache;
  } catch {
    _cache = [];
    return [];
  }
}

async function saveLocal(items) {
  _cache = items;
  try {
    await mkdir(join(process.cwd(), 'data'), { recursive: true });
    await writeFile(LOCAL_PATH, JSON.stringify(items, null, 2), 'utf-8');
  } catch (e) {
    console.error('[TemplateStore] local write failed:', e.message);
  }
}

// ── Supabase helpers ─────────────────────────────────────────────
async function supabaseGetAll() {
  const sb = getSupabase();
  const { data, error } = await sb
    .from(TABLE).select('data')
    .eq('store_name', STORE_NAME)
    .order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  return (data || []).map(r => r.data);
}

async function supabaseUpsert(template) {
  const sb = getSupabase();
  const { error } = await sb.from(TABLE).upsert({
    id: template.id,
    store_name: STORE_NAME,
    data: template,
    created_at: template.createdAt || new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }, { onConflict: 'id' });
  if (error) throw new Error(error.message);
}

async function supabaseDelete(id) {
  const sb = getSupabase();
  const { error } = await sb.from(TABLE).delete()
    .eq('id', id).eq('store_name', STORE_NAME);
  if (error) throw new Error(error.message);
}

// ── Public API ───────────────────────────────────────────────────

/** List all saved templates */
export async function getTemplates() {
  if (isSupabaseReady()) {
    try {
      const items = await supabaseGetAll();
      if (items.length > 0) {
        console.log('[TemplateStore] ✅ Supabase: ' + items.length + ' templates');
        return items;
      }
    } catch (e) {
      console.warn('[TemplateStore] Supabase failed, using local:', e.message);
    }
  }
  const local = await loadLocal();
  console.log('[TemplateStore] 📁 Local file: ' + local.length + ' templates');
  return local;
}

/** Save (create or update) a template */
export async function saveTemplate(template) {
  if (!template.id) throw new Error('template.id required');

  // Supabase
  if (isSupabaseReady()) {
    try {
      await supabaseUpsert(template);
      console.log('[TemplateStore] ✅ Saved to Supabase:', template.id);
    } catch (e) {
      console.warn('[TemplateStore] Supabase save failed, saving local:', e.message);
    }
  }

  // Always write to local file (dual-write)
  const existing = await loadLocal();
  const idx = existing.findIndex(t => t.id === template.id);
  if (idx >= 0) existing[idx] = template;
  else existing.unshift(template);
  await saveLocal(existing);
  return template;
}

/** Delete a template by id */
export async function deleteTemplate(id) {
  if (isSupabaseReady()) {
    try { await supabaseDelete(id); } catch (e) {
      console.warn('[TemplateStore] Supabase delete failed:', e.message);
    }
  }
  const existing = await loadLocal();
  await saveLocal(existing.filter(t => t.id !== id));
}

/** Get one template by id */
export async function getTemplate(id) {
  const all = await getTemplates();
  return all.find(t => t.id === id) || null;
}

/** Duplicate a template */
export async function duplicateTemplate(id) {
  const original = await getTemplate(id);
  if (!original) throw new Error('Template not found: ' + id);
  const copy = {
    ...original,
    id: 'tmpl_' + Date.now(),
    templateName: original.templateName + ' (copy)',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    isFavorite: false,
  };
  return saveTemplate(copy);
}
