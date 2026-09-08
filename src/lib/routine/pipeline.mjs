import { RoutineError } from './errors.mjs';

const PIPELINE_BUDGET_MS = 700_000;
const PIPELINE_FAILURE_MESSAGE = 'The news pipeline could not complete this request.';

function pipelineFailure(error) {
  const errorType = typeof error?.errorType === 'string'
    && error.errorType.length <= 80
    && /^[A-Z][A-Z0-9_]*$/.test(error.errorType)
    ? error.errorType
    : 'ROUTINE_PIPELINE_FAILED';
  return new RoutineError(502, errorType, PIPELINE_FAILURE_MESSAGE);
}

/** Injectable adapter; prepare never loads or calls news, workflow, or database services. */
export function createPipeline({
  detectInputType,
  routePipeline,
  createPipelineDeadline,
  runWithPipelineDeadline,
  isPipelineDeadlineError,
  loadExecutionDependencies,
  env = process.env,
  now = Date.now,
}) {
  const plans = new WeakSet();

  function prepare({ input, contentLength = 'medium' }, mode = 'news') {
    if (typeof input !== 'string' || !['short', 'medium', 'long'].includes(contentLength)) {
      throw new RoutineError(400, 'INVALID_REQUEST_FIELDS', 'Invalid input or contentLength.');
    }
    const queued = mode === 'jobs' || mode === 'queue';
    if (!queued && mode !== 'news' && mode !== 'process') {
      throw new RoutineError(400, 'INVALID_REQUEST_FIELDS', 'Invalid routine processing mode.');
    }

    // Preserve /queue/add validation before its worker runs /auto/process detection.
    if (queued && input.length > 30 && (input.match(/\?/g) || []).length / input.length > 0.3) {
      throw new RoutineError(400, 'GARBLED_INPUT', 'The input contains too many damaged characters.');
    }
    if (queued && env.TEXT_ONLY_MODE !== '0' && /https?:\/\//i.test(input)) {
      throw new RoutineError(400, 'TEXT_ONLY_MODE', 'Only plain text input is currently enabled.');
    }

    const detection = detectInputType(input, []);
    const route = routePipeline(detection);
    if (detection.inputType === 'empty') {
      throw new RoutineError(400, 'EMPTY_INPUT', 'Input must not be empty.');
    }
    if (env.TEXT_ONLY_MODE !== '0' && (detection.hasUrls || detection.hasImage)) {
      throw new RoutineError(400, 'TEXT_ONLY_MODE', 'Only plain text input is currently enabled.');
    }

    // Only these branches have a direct service boundary in the original route.
    const delegated = route.useEnhancedPipeline && (detection.primaryUrl || detection.hasText);
    const delegate = delegated
      ? (detection.inputType === 'plain_text' || (!detection.primaryUrl && detection.hasText) ? 'text' : 'url')
      : null;
    if (!queued && !delegate) {
      throw new RoutineError(400, 'ROUTINE_UNSUPPORTED_INPUT', 'This input requires the queued news workflow.');
    }
    const plan = Object.freeze({ input, contentLength, detection, route, delegate });
    plans.add(plan);
    return plan;
  }

  async function execute(plan, workflowId) {
    if (!plans.has(plan) || !plan.delegate) {
      throw new RoutineError(400, 'ROUTINE_UNSUPPORTED_INPUT', 'A supported prepared news request is required.');
    }
    try {
      const deadline = createPipelineDeadline({ deadlineAt: now() + PIPELINE_BUDGET_MS });
      return await runWithPipelineDeadline(deadline, async () => {
        const execution = await loadExecutionDependencies(plan.delegate);
        deadline.throwIfExpired('pipeline_load');
        const text = plan.detection.textContent || plan.input;
        const args = {
          url: plan.delegate === 'text' ? null : plan.detection.primaryUrl || null,
          text,
          ...(plan.delegate === 'text' ? { sourceType: 'plain_text' } : {}),
          contentLength: plan.contentLength,
          preset: '',
          workflowId,
          user: undefined,
          deskMeta: null,
        };

        if (plan.delegate === 'text') {
          if (!execution.isSupabaseReady()) {
            throw new RoutineError(503, 'WORKFLOW_PERSISTENCE_UNAVAILABLE', 'Workflow storage is temporarily unavailable.');
          }
          try {
            await execution.ensureWorkflow(workflowId, { sourceType: 'plain_text', rawInput: text });
            deadline.throwIfExpired('workflow_init');
          } catch (error) {
            if (isPipelineDeadlineError(error)) throw error;
            const conflict = error?.code === 'WORKFLOW_CONTEXT_CONFLICT';
            throw new RoutineError(
              conflict ? 409 : 503,
              conflict ? 'WORKFLOW_CONTEXT_CONFLICT' : 'WORKFLOW_INIT_FAILED',
              conflict ? 'The workflow belongs to another input.' : 'Workflow storage could not be initialized.',
            );
          }
        }

        let result;
        try {
          result = await (plan.delegate === 'text' ? execution.processAutoFlowText(args) : execution.processAutoFlow(args));
          deadline.throwIfExpired('delegate_complete');
        } catch (error) {
          if (isPipelineDeadlineError(error)) throw error;
          throw pipelineFailure(error);
        }
        if (result?.success !== true) throw pipelineFailure(result);
        return result;
      });
    } catch (error) {
      if (isPipelineDeadlineError(error)) {
        throw new RoutineError(504, 'PIPELINE_DEADLINE_EXCEEDED', 'The news pipeline exceeded its time limit.');
      }
      if (error instanceof RoutineError) throw error;
      throw pipelineFailure(error);
    }
  }

  return Object.freeze({ prepare, execute });
}

/** Called only after routine authorization; heavyweight imports wait until execute. */
export async function loadPipeline({ env = process.env } = {}) {
  const [detector, router, deadline] = await Promise.all([
    import('@/lib/input-engine/detector'),
    import('@/lib/input-engine/router'),
    import('@/lib/utils/pipelineDeadline'),
  ]);
  return createPipeline({
    detectInputType: detector.detectInputType,
    routePipeline: router.routePipeline,
    createPipelineDeadline: deadline.createPipelineDeadline,
    runWithPipelineDeadline: deadline.runWithPipelineDeadline,
    isPipelineDeadlineError: deadline.isPipelineDeadlineError,
    env,
    async loadExecutionDependencies(delegate) {
      if (delegate === 'text') {
        const [service, workflow, database] = await Promise.all([
          import('@/lib/services/autoFlowServiceText'),
          import('@/lib/workflow/workflowEngine'),
          import('@/lib/supabase'),
        ]);
        return {
          processAutoFlowText: service.processAutoFlowText,
          ensureWorkflow: workflow.ensureWorkflow,
          isSupabaseReady: database.isSupabaseReady,
        };
      }
      const service = await import('@/lib/services/autoFlowService');
      return { processAutoFlow: service.processAutoFlow };
    },
  });
}
