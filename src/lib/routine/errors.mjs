export class RoutineError extends Error {
  constructor(status, errorType, message) {
    super(message);
    this.status = status;
    this.errorType = errorType;
  }
}

export function errorReply(error) {
  const known = error instanceof RoutineError;
  return {
    status: known ? error.status : 500,
    body: {
      success: false,
      error: known ? error.message : 'Routine API ไม่สามารถทำรายการนี้ได้',
      errorType: known ? error.errorType : 'ROUTINE_INTERNAL_ERROR',
    },
  };
}
