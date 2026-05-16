/**
 * ========================================
 * MASTER AGENT — Orchestrator ควบคุมทุก Agent
 * ========================================
 * 
 * ทุก step ต้องผ่าน Master Agent
 * Master Agent ดูแล:
 * 1. Shared Memory (workflowMemory)
 * 2. Context propagation
 * 3. Agent coordination
 * 4. Output validation
 * 
 * Flow:
 *   Master Agent
 *     ├── Research Agent (extract + enrich)
 *     ├── Analysis Agent (breakdown + angles)
 *     ├── Hook Agent (headlines + openings)
 *     ├── Writer Agent (content generation)
 *     ├── Safety Agent (validation + rewrite)
 *     └── Scoring Agent (viral score + quality)
 */

import { getWorkflow, saveExtraction, saveBreakdown, saveAnalysis } from '../workflow/workflowEngine.js';
import { prisma } from '../db.js';

// ============================================
// SHARED WORKFLOW MEMORY
// ============================================
// นี่คือ structured context object ที่ทุก agent อ่าน/เขียนร่วมกัน
// ไม่ใช่ raw text — เป็น structured data

export function createWorkflowMemory(workflowId) {
  return {
    workflowId,
    
    // === Source Data (จาก Step 1) ===
    source: {
      rawInput: '',        // ข้อความดิบที่ผู้ใช้ใส่
      url: '',             // URL ต้นทาง
      sourceType: '',      // url/paste/facebook/tiktok
      extractionMethod: '',// firecrawl/jina/direct
    },

    // === Extracted Content (จาก Research Agent) ===
    extracted: {
      title: '',
      body: '',            // เนื้อข่าวเต็ม (ห้ามตัด)
      source: '',          // แหล่งข่าว
      date: '',
      category: '',
      bodyLength: 0,
    },

    // === Entity Map (จาก Research Agent) ===
    entities: {
      people: [],          // [{ name, role, sentiment }]
      places: [],          // [{ name, significance }]
      organizations: [],   // [{ name, role }]
      numbers: [],         // [{ value, context }]
      dates: [],           // [{ date, event }]
      quotes: [],          // [{ text, speaker }]
    },

    // === Emotional Analysis (จาก Analysis Agent) ===
    emotional: {
      coreEmotion: '',     // อารมณ์หลักของข่าว
      emotionalCore: '',   // แก่น emotional
      conflictPoint: '',   // จุดขัดแย้ง
      viralTrigger: '',    // สิ่งที่ทำให้คนอยากแชร์
      painPoints: [],      // ความเจ็บปวด
      emotionalHooks: [],  // จุดที่คนจะอิน
      emotionalPeak: '',   // จุดอารมณ์สูงสุด
    },

    // === Tone Map (จาก Analysis Agent) ===
    toneMap: {
      overallTone: '',     // โทนรวม (เศร้า/โกรธ/อบอุ่น/ตกใจ)
      toneShifts: [],      // จุดที่โทนเปลี่ยน
      suggestedTone: '',   // โทนที่แนะนำสำหรับเขียน
    },

    // === Viral Angles (จาก Analysis Agent) ===
    angles: {
      possibleAngles: [],  // [{ name, description, viralScore, emotion, shareTrigger }]
      bestAngle: null,     // { name, whyBest, strength, safety }
      suggestedAngles: [], // มุมที่แนะนำเพิ่มเติม
    },

    // === Language Strategy (จาก Hook Agent) ===
    languageStrategy: {
      openingStyle: '',    // เปิดด้วยอะไร
      storytellingStyle: '',// เล่าแบบไหน
      emotionalPacing: '', // จังหวะอารมณ์
      endingStyle: '',     // ปิดแบบไหน
    },

    // === Generated Content (จาก Writer Agent) ===
    outputs: {
      versions: [],        // [{ style, title, content, hook, closing, tone }]
      newsReference: '',   // อ้างอิงข่าวต้นฉบับ
    },

    // === Validation (จาก Safety Agent) ===
    validation: {
      safetyPassed: false,
      factCheckPassed: false,
      riskyWordsFound: [],
      riskyWordsReplaced: [],
      issues: [],
    },

    // === Scoring (จาก Scoring Agent) ===
    scoring: {
      viralScore: 0,       // 0-100
      qualityScore: 0,     // 0-100
      safetyScore: 0,      // 0-100
      overallScore: 0,     // 0-100
    },

    // === Execution Log ===
    executionLog: [],      // [{ agent, action, timestamp, duration, tokensUsed }]
    
    // === Metadata ===
    createdAt: new Date().toISOString(),
    lastUpdatedAt: new Date().toISOString(),
    currentStep: 'init',
  };
}

// ============================================
// MASTER AGENT — Orchestrator
// ============================================

export class MasterAgent {
  constructor(workflowId) {
    this.workflowId = workflowId;
    this.memory = createWorkflowMemory(workflowId);
  }

  // โหลด memory จาก DB
  async loadFromDB() {
    const wf = await getWorkflow(this.workflowId);
    if (!wf) return false;

    // Hydrate memory จาก DB
    this.memory.extracted = {
      title: wf.newsTitle || '',
      body: wf.newsBody || '',
      source: wf.newsSource || '',
      date: wf.newsDate || '',
      category: wf.newsCategory || '',
      bodyLength: (wf.newsBody || '').length,
    };
    this.memory.source.rawInput = wf.rawInput || '';
    this.memory.source.sourceType = wf.sourceType || '';
    this.memory.currentStep = wf.currentStep || 'init';

    // Hydrate breakdown data
    if (wf.breakdownData) {
      const bd = wf.breakdownData;
      this.memory.emotional = {
        coreEmotion: bd.core_story || '',
        emotionalCore: bd.main_emotional_core || '',
        conflictPoint: bd.conflict_point || '',
        viralTrigger: bd.viral_trigger || '',
        painPoints: bd.pain_points || [],
        emotionalHooks: bd.emotional_hooks || [],
        emotionalPeak: '',
      };
      this.memory.entities = {
        people: bd.key_facts?.people || [],
        places: bd.key_facts?.places || [],
        organizations: [],
        numbers: bd.key_facts?.numbers || [],
        dates: bd.key_facts?.dates || [],
        quotes: bd.quotes || [],
      };
      this.memory.angles = {
        possibleAngles: bd.possible_angles || [],
        bestAngle: bd.best_main_angle || null,
        suggestedAngles: bd.suggested_angles || [],
      };
      this.memory.languageStrategy = {
        openingStyle: bd.language_strategy?.opening_style || '',
        storytellingStyle: bd.language_strategy?.storytelling_style || '',
        emotionalPacing: bd.language_strategy?.emotional_pacing || '',
        endingStyle: bd.language_strategy?.ending_style || '',
      };
    }

    // Hydrate analysis
    if (wf.analysisResult) {
      this.memory.outputs = {
        versions: wf.analysisResult.versions || [],
        newsReference: wf.analysisResult.news_reference || '',
      };
    }

    console.log(`[MasterAgent] ✅ Loaded from DB: title="${(this.memory.extracted.title || '').slice(0, 50)}", bodyLen=${this.memory.extracted.bodyLength}, step=${this.memory.currentStep}`);
    return true;
  }

  // Log action
  log(agent, action, extra = {}) {
    const entry = {
      agent,
      action,
      timestamp: new Date().toISOString(),
      ...extra,
    };
    this.memory.executionLog.push(entry);
    this.memory.lastUpdatedAt = new Date().toISOString();
    console.log(`[${agent}] ${action}`, extra.detail || '');
  }

  // ============================================
  // CONTEXT COMPILER — สร้าง prompt context จาก memory
  // ============================================
  // แทนที่ buildFullContext() เดิม — ดึงจาก structured memory ไม่ใช่ raw text
  
  compileContext(options = {}) {
    const m = this.memory;
    const { includeNews = true, includeEntities = true, includeAngles = true, includeLanguage = true } = options;
    
    let ctx = '';

    // 1. เนื้อข่าวเต็ม
    if (includeNews && m.extracted.body) {
      ctx += `=== เนื้อข่าวต้นฉบับ (${m.extracted.bodyLength} ตัวอักษร) ===\n`;
      ctx += `หัวข้อ: ${m.extracted.title}\n`;
      if (m.extracted.source) ctx += `แหล่ง: ${m.extracted.source}\n`;
      if (m.extracted.date) ctx += `วันที่: ${m.extracted.date}\n`;
      ctx += `\n${m.extracted.body}\n`;
      ctx += `=== จบเนื้อข่าว ===\n\n`;
    }

    // 2. Entity Map
    if (includeEntities && this._hasEntities()) {
      ctx += `=== Entity Map ===\n`;
      if (m.entities.people?.length) ctx += `บุคคล: ${m.entities.people.map(p => typeof p === 'string' ? p : p.name).join(', ')}\n`;
      if (m.entities.places?.length) ctx += `สถานที่: ${m.entities.places.map(p => typeof p === 'string' ? p : p.name).join(', ')}\n`;
      if (m.entities.numbers?.length) ctx += `ตัวเลข: ${m.entities.numbers.map(n => typeof n === 'string' ? n : n.value).join(', ')}\n`;
      if (m.entities.dates?.length) ctx += `วันที่: ${m.entities.dates.map(d => typeof d === 'string' ? d : d.date).join(', ')}\n`;
      if (m.entities.quotes?.length) ctx += `คำพูดสำคัญ: ${m.entities.quotes.map(q => typeof q === 'string' ? q : q.text).join(' | ')}\n`;
      ctx += `=== จบ Entity Map ===\n\n`;
    }

    // 3. Emotional Analysis
    if (m.emotional.emotionalCore) {
      ctx += `=== Emotional Analysis ===\n`;
      ctx += `แก่นข่าว: ${m.emotional.coreEmotion}\n`;
      ctx += `Emotional Core: ${m.emotional.emotionalCore}\n`;
      if (m.emotional.conflictPoint) ctx += `Conflict: ${m.emotional.conflictPoint}\n`;
      if (m.emotional.viralTrigger) ctx += `Viral Trigger: ${m.emotional.viralTrigger}\n`;
      if (m.emotional.emotionalHooks?.length) ctx += `จุดที่คนอิน: ${m.emotional.emotionalHooks.join(' | ')}\n`;
      if (m.emotional.painPoints?.length) ctx += `Pain Points: ${m.emotional.painPoints.join(' | ')}\n`;
      ctx += `=== จบ Emotional Analysis ===\n\n`;
    }

    // 4. Tone Map
    if (m.toneMap.overallTone) {
      ctx += `=== Tone Map ===\n`;
      ctx += `โทนรวม: ${m.toneMap.overallTone}\n`;
      if (m.toneMap.suggestedTone) ctx += `โทนแนะนำ: ${m.toneMap.suggestedTone}\n`;
      ctx += `=== จบ Tone Map ===\n\n`;
    }

    // 5. Viral Angles
    if (includeAngles && m.angles.possibleAngles?.length > 0) {
      ctx += `=== Viral Angles (${m.angles.possibleAngles.length} มุม) ===\n`;
      m.angles.possibleAngles.forEach((a, i) => {
        ctx += `${i + 1}. ${a.angle_name}: ${a.description} [อารมณ์: ${a.target_emotion || '-'}, viral: ${a.facebook_viral_score || '-'}/10]\n`;
        if (a.why_people_connect) ctx += `   → คนอินเพราะ: ${a.why_people_connect}\n`;
        if (a.share_trigger) ctx += `   → แชร์เพราะ: ${a.share_trigger}\n`;
      });
      if (m.angles.bestAngle) {
        ctx += `\n🏆 มุมที่ดีที่สุด: ${m.angles.bestAngle.angle_name} — ${m.angles.bestAngle.why_best}\n`;
      }
      ctx += `=== จบ Viral Angles ===\n\n`;
    }

    // 6. Language Strategy
    if (includeLanguage && m.languageStrategy.openingStyle) {
      ctx += `=== Language Strategy ===\n`;
      ctx += `เปิด: ${m.languageStrategy.openingStyle}\n`;
      ctx += `เล่า: ${m.languageStrategy.storytellingStyle}\n`;
      ctx += `จังหวะ: ${m.languageStrategy.emotionalPacing}\n`;
      ctx += `ปิด: ${m.languageStrategy.endingStyle}\n`;
      ctx += `=== จบ Language Strategy ===\n\n`;
    }

    // 7. คำสั่งเหล็ก
    ctx += `⚠️ คำสั่งเหล็ก: ใช้ข้อมูลทั้งหมดข้างต้น ห้ามแต่งเพิ่ม ห้ามตัดข้อมูลสำคัญ เขียนยาวอย่างน้อย 280 คำต่อเวอร์ชัน\n`;

    return ctx;
  }

  _hasEntities() {
    const e = this.memory.entities;
    return (e.people?.length > 0 || e.places?.length > 0 || e.numbers?.length > 0 || e.quotes?.length > 0);
  }

  // ============================================
  // STEP HANDLERS — แต่ละ step ผ่าน Master Agent
  // ============================================

  // Research Agent เสร็จ → update memory
  onExtractionComplete(data) {
    this.memory.extracted = {
      title: data.newsTitle || '',
      body: data.newsBody || '',
      source: data.newsSource || '',
      date: data.newsDate || '',
      category: data.newsCategory || '',
      bodyLength: (data.newsBody || '').length,
    };
    this.memory.currentStep = 'extracted';
    this.log('ResearchAgent', `Extraction complete: ${this.memory.extracted.bodyLength}ch, title="${this.memory.extracted.title}"`);
  }

  // Analysis Agent เสร็จ → update memory  
  onBreakdownComplete(data) {
    this.memory.emotional = {
      coreEmotion: data.core_story || '',
      emotionalCore: data.main_emotional_core || '',
      conflictPoint: data.conflict_point || '',
      viralTrigger: data.viral_trigger || '',
      painPoints: data.pain_points || [],
      emotionalHooks: data.emotional_hooks || [],
      emotionalPeak: '',
    };
    this.memory.entities = {
      people: data.key_facts?.people || [],
      places: data.key_facts?.places || [],
      organizations: [],
      numbers: data.key_facts?.numbers || [],
      dates: data.key_facts?.dates || [],
      quotes: data.quotes || [],
    };
    this.memory.angles = {
      possibleAngles: data.possible_angles || [],
      bestAngle: data.best_main_angle || null,
      suggestedAngles: data.suggested_angles || [],
    };
    this.memory.languageStrategy = {
      openingStyle: data.language_strategy?.opening_style || '',
      storytellingStyle: data.language_strategy?.storytelling_style || '',
      emotionalPacing: data.language_strategy?.emotional_pacing || '',
      endingStyle: data.language_strategy?.ending_style || '',
    };
    this.memory.toneMap = {
      overallTone: data.main_emotional_core || '',
      toneShifts: [],
      suggestedTone: data.language_strategy?.storytelling_style || '',
    };
    this.memory.currentStep = 'breakdown';
    this.log('AnalysisAgent', `Breakdown complete: ${this.memory.angles.possibleAngles.length} angles, best="${this.memory.angles.bestAngle?.angle_name || 'none'}"`);
  }

  // Writer Agent เสร็จ → update memory
  onAnalysisComplete(data) {
    this.memory.outputs = {
      versions: data.versions || [],
      newsReference: data.news_reference || '',
    };
    this.memory.currentStep = 'analyzed';
    this.log('WriterAgent', `Analysis complete: ${this.memory.outputs.versions.length} versions`);
  }

  // Validation Agent
  onValidationComplete(result) {
    this.memory.validation = result;
    this.log('SafetyAgent', `Validation: ${result.safetyPassed ? '✅ PASS' : '⚠️ ISSUES: ' + result.issues.join(', ')}`);
  }

  // สร้าง debug snapshot
  getDebugSnapshot() {
    return {
      workflowId: this.workflowId,
      currentStep: this.memory.currentStep,
      extracted: {
        title: this.memory.extracted.title,
        bodyLength: this.memory.extracted.bodyLength,
      },
      entities: {
        people: this.memory.entities.people?.length || 0,
        places: this.memory.entities.places?.length || 0,
        quotes: this.memory.entities.quotes?.length || 0,
      },
      emotional: {
        core: this.memory.emotional.emotionalCore?.slice(0, 80) || '',
        hooks: this.memory.emotional.emotionalHooks?.length || 0,
      },
      angles: {
        total: this.memory.angles.possibleAngles?.length || 0,
        best: this.memory.angles.bestAngle?.angle_name || 'none',
      },
      outputs: {
        versions: this.memory.outputs.versions?.length || 0,
      },
      executionLog: this.memory.executionLog.length,
      lastUpdated: this.memory.lastUpdatedAt,
    };
  }

  // Save memory snapshot ลง DB metadata
  async saveMemoryToDB() {
    try {
      await prisma.workflowRun.update({
        where: { id: this.workflowId },
        data: {
          metadata: JSON.stringify({
            entities: this.memory.entities,
            emotional: this.memory.emotional,
            toneMap: this.memory.toneMap,
            languageStrategy: this.memory.languageStrategy,
            scoring: this.memory.scoring,
            validation: this.memory.validation,
            executionLog: this.memory.executionLog.slice(-20), // keep last 20 entries
          }),
        },
      });
      this.log('MasterAgent', 'Memory saved to DB');
    } catch (e) {
      console.error('[MasterAgent] Save memory error:', e.message);
    }
  }
}
