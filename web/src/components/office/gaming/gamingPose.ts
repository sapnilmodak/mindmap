// Seated pose and typing motion. Each entry is a rotation (radians, about the
// character's own x, y, z; x is side to side, y is up, z is forward) applied to
// that bone's rest orientation. Parents must come before children.
export type Delta = [number, number, number];

export const POSE_SIT: Record<string, Delta> = {
  Hips: [0, 0, 0],
  Torso: [0, 0, 0],
  'UpperLeg.L': [-1.45, 0, 0], 'UpperLeg.R': [-1.45, 0, 0],
  'LowerLeg.L': [0, 0, 0], 'LowerLeg.R': [0, 0, 0],
  'UpperArm.L': [-0.5, 0, 0.12], 'UpperArm.R': [-0.5, 0, -0.12],
  'LowerArm.L': [-1.2, 0, 0], 'LowerArm.R': [-1.2, 0, 0],
  Head: [0.15, 0, 0],
};

export interface TypeMotion { amp: number; hz: number; phase: number; bias: Delta }
export const POSE_TYPE: Record<string, TypeMotion | undefined> = {
  'LowerArm.L': { amp: 0.07, hz: 2.3, phase: 0, bias: [0, 0, 0] },
  'LowerArm.R': { amp: 0.07, hz: 2.7, phase: 1.7, bias: [0, 0, 0] },
  Head: { amp: 0.03, hz: 0.4, phase: 0, bias: [0, 0, 0] },
};
