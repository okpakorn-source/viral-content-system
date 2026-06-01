import { prisma } from '@/lib/db';

// Pricing per 1,000,000 tokens (USD)
const PRICING = {
  'gpt-4o': { input: 5.0, output: 15.0 },
  'gpt-4o-mini': { input: 0.15, output: 0.60 },
  'claude-sonnet-4-6': { input: 3.0, output: 15.0 },
  'claude-sonnet-4-20250514': { input: 3.0, output: 15.0 },
  'claude-3-5-sonnet-20240620': { input: 3.0, output: 15.0 },
  'claude-3-5-sonnet-20241022': { input: 3.0, output: 15.0 },
  'gemini-2.5-flash': { input: 0.15, output: 0.60 },
  'gemini-2.5-pro': { input: 1.25, output: 10.0 },
  'gemini-1.5-pro': { input: 3.5, output: 10.5 },
  'gemini-1.5-flash': { input: 0.075, output: 0.30 },
};

export async function logApiUsage({ provider, model, inputTokens, outputTokens, feature = 'autoFlow', userId = null }) {
  try {
    let costUsd = 0;
    
    // Find matching price, defaulting to 0 if not found
    const price = PRICING[model] || Object.values(PRICING).find((_, key) => model.includes(key));
    
    if (price) {
      costUsd = ((inputTokens / 1000000) * price.input) + ((outputTokens / 1000000) * price.output);
    }

    await prisma.apiUsageLog.create({
      data: {
        provider,
        model,
        inputTokens,
        outputTokens,
        costUsd,
        feature,
        userId,
      }
    });
    
    console.log(`[API Usage] Saved: ${provider}/${model} - Cost: $${costUsd.toFixed(5)}`);
  } catch (error) {
    console.error('[API Usage] Failed to save usage log:', error.message);
  }
}
