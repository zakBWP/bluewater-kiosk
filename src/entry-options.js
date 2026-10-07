export const PAY_GRADES = [
  'E-1', 'E-2', 'E-3', 'E-4', 'E-5', 'E-6', 'E-7', 'E-8', 'E-9',
  'W-1', 'W-2', 'W-3', 'W-4', 'W-5',
  'O-1', 'O-2', 'O-3', 'O-4', 'O-5', 'O-6', 'O-7',
  'CIV',
];

// The rate/rank field is just "Rank" for these command types.
export const RANK_ONLY_COMMAND_TYPES = ['The Basic School'];

export function rateLabelFor(commandType) {
  return RANK_ONLY_COMMAND_TYPES.includes(commandType) ? 'Rank' : 'Rate/Rank';
}
