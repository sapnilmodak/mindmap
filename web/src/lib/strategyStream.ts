// Types-only extract of tara-dashboard/src/lib/strategyStream.ts: the event contract the 3D office consumes.
// (The original file also holds TARA's networking code, which is not needed to run the animation.)

export interface WorkerSeat { worker: string; title: string; why: string }

export type DigitalWorkerEvent =
  // `seats` is present only when ADEO picked the team: a display title and the reason for each worker.
  | { type: 'worker_roster'; workers: string[]; wave1: string[]; wave2: string[]; seats?: WorkerSeat[] }
  | { type: 'worker_start'; worker: string; wave: number }
  | { type: 'worker_end'; worker: string; wave: number; status: string; confidence: number; analysis: string; verdict?: 'support' | 'concern' | 'neutral' }
  | { type: 'worker_message'; from: string; to: string; snippet: string }
  // A worker couldn't give a real answer without more context (see the
  // CLARIFY sentinel in strategy-service's _run_worker_via_openexecutive)
  // and is now parked server-side awaiting POST /strategy/answer-question
  // — see answerWorkerQuestion below.
  | { type: 'worker_question'; questionId: string; worker: string; wave: number; question: string }
  | { type: 'worker_question_answered'; questionId: string; worker: string; answer: string }
  | { type: 'worker_question_timeout'; questionId: string; worker: string };
