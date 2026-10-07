export const COMMAND_TYPES = [
  'CVN (Nimitz-class)', 'CVN (Ford-class)', 'CG', 'DDG', 'LCC', 'LCS',
  'LHA', 'LHD', 'LPD', 'LSD', 'The Basic School', 'Other',
];

// Starting departments and divisions for each command type. A new job gets its own copy,
// which can then be edited without changing these templates. Command types that aren't
// listed start with no departments.
export const COMMAND_STRUCTURES = {
  DDG: [
    { name: 'Combat Systems', divisions: ['CC', 'CE', 'CF'] },
    { name: 'Engineering', divisions: ['EA', 'EE', 'EM', 'ER', 'MP'] },
    { name: 'Executive', divisions: ['Admin', 'HM', 'NN'] },
    { name: 'Operations', divisions: ['OD', 'OI', 'OT'] },
    { name: 'Weapons', divisions: ['CA', 'CG', 'CM'] },
    { name: 'Supply', divisions: ['S-1', 'S-2', 'S-3'] },
    { name: 'Air Det', divisions: [] },
  ],
  'The Basic School': [
    { name: '1st Platoon', divisions: [] },
    { name: '2nd Platoon', divisions: [] },
    { name: '3rd Platoon', divisions: [] },
    { name: '4th Platoon', divisions: [] },
    { name: '5th Platoon', divisions: [] },
    { name: '6th Platoon', divisions: [] },
    { name: 'Staff', divisions: [] },
  ],
};
