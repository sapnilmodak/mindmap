// Every user-facing string in the office view, in one place. English only.
export const OFFICE_TEXT = {
  status: { idle: 'Idle', waiting: 'Waiting', working: 'Working', handoff: 'Handing off', blocked: 'Needs input', done: 'Done' },
  header: { workers: 'Digital workers', active: 'Active', done: 'done', blocked: 'waiting on you', feed: 'Live activity', empty: 'Waiting for the team to start.' },
  hub: { title: 'Orchestration', waiting: 'Waiting for the team', working: 'working', done: 'All workers done' },
  exec: {
    title: 'Executive Oversight', sub: 'Approvals, reports, strategy',
    oneWaiting: 'worker needs your answer', manyWaiting: 'workers need your answer',
    steps: ['Intake', 'Process', 'Review', 'Approve', 'Complete'],
  },
  desk: { empty: 'Open desk' },
  switch: { label: 'Characters', realistic: 'Realistic', pixel: 'Pixel', gaming: 'Gaming' },
  gaming: { loading: 'Loading the 3D office…', failed: 'The 3D office needs WebGL, which this browser could not start. Switch to Realistic or Pixel.', hintInside: 'Drag to look around · scroll or W A S D to walk · click a person', hintOverview: 'Drag to turn around the building · scroll to zoom', toOverview: 'Outside view', toInside: 'Step inside' },
  controls: { replay: 'Replay', live: 'Live', fullscreen: 'Enter full screen', exitFullscreen: 'Exit full screen', showPanel: 'Details', hidePanel: 'Hide details' },
  questions: {
    title: 'Questions from workers', one: 'A worker needs your input', many: 'workers need your input',
    hint: 'The pipeline is paused until you answer. If nobody answers within 10 minutes the worker continues without it.',
    placeholder: 'Type your answer…', shortcut: 'Ctrl/⌘ + Enter to send', send: 'Answer & resume',
  },
  detail: {
    title: 'Worker details', close: 'Close details', confidence: 'confidence',
    working: 'Working at their desk. The model call is in flight and has no output yet.',
    waiting: 'Waiting for the first wave to finish.',
    idle: 'Ready for their turn.',
  },
  feed: { title: 'Activity', replaying: 'replaying', empty: 'Nothing has happened yet.' },
  overflow: (names: string) => `Not shown at a desk (all nine are taken): ${names}.`,
} as const;
