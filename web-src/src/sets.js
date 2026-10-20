// The 12 cosmetic sets, in the order the dice models were built.
export const SETS = [
  { id: 'altmer', name: 'Altmer', text: 'plum stone, pale gold numbers' },
  { id: 'argonian', name: 'Argonian', text: 'dark jade, scaled edges' },
  { id: 'ayleid', name: 'Ayleid', text: 'weathered stone, blue glow' },
  { id: 'bosmer', name: 'Bosmer', text: 'green stained wood, gold numbers' },
  { id: 'breton', name: 'Breton', text: 'sapphire stone, silver edges' },
  { id: 'daedric', name: 'Daedric', text: 'black metal, ember numbers' },
  { id: 'dunmer', name: 'Dunmer', text: 'ash stone, crimson numbers' },
  { id: 'imperial', name: 'Imperial', text: 'weathered gold, black numbers' },
  { id: 'khajiit', name: 'Khajiit', text: 'amber resin, black numbers' },
  { id: 'nord', name: 'Nord', text: 'ice-grey stone, steel edges' },
  { id: 'orc', name: 'Orc', text: 'hammered gunmetal, copper numbers' },
  { id: 'redguard', name: 'Redguard', text: 'oxblood stone, gold border' },
];

export const DEFAULT_SET = 'imperial';

export const byId = (id) => SETS.find((s) => s.id === id);
