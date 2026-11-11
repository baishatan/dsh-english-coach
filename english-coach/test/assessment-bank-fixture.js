// Synthetic, self-authored examples for isolated admission tests, not a calibrated bank.
const examples = [
  ['grammar', 'She ___ a student.', ['am', 'is', 'are', 'be'], 1],
  ['vocab', 'A cat is an ___.', ['animal', 'office', 'idea', 'hour'], 0],
  ['grammar', 'They ___ at home now.', ['is', 'am', 'are', 'be'], 2],
  ['vocab', 'The opposite of hot is ___.', ['large', 'fast', 'early', 'cold'], 3],
  ['grammar', 'We ___ the museum yesterday.', ['visit', 'visited', 'visiting', 'visits'], 1],
  ['vocab', 'Please ___ the light before leaving.', ['turn off', 'look after', 'give up', 'take over'], 0],
  ['grammar', 'There are ___ apples in the basket.', ['much', 'any', 'some', 'a'], 2],
  ['vocab', 'The train was late, so we had to ___.', ['arrive', 'borrow', 'invite', 'wait'], 3],
  ['grammar', 'If it rains, we ___ indoors.', ['stayed', 'will stay', 'staying', 'had stayed'], 1],
  ['vocab', 'Her answer was brief rather than ___.', ['lengthy', 'accurate', 'polite', 'useful'], 0],
  ['grammar', 'This is the book ___ I mentioned.', ['who', 'where', 'that', 'whose'], 2],
  ['vocab', 'The new evidence may ___ our conclusion.', ['arrange', 'borrow', 'repair', 'affect'], 3],
  ['grammar', 'Only then ___ the missing key.', ['she noticed', 'did she notice', 'she did notice', 'had she notice'], 1],
  ['vocab', 'The plan is tentative, so it may ___.', ['change', 'vanish forever', 'be compulsory', 'remain final'], 0],
  ['grammar', 'I wish I ___ more time today.', ['have', 'will have', 'had', 'having'], 2],
  ['vocab', 'His account was plausible but not yet ___.', ['possible', 'credible', 'likely', 'verified'], 3],
  ['grammar', 'Had we known earlier, we ___ differently.', ['act', 'would have acted', 'will act', 'are acting'], 1],
  ['vocab', 'A meticulous editor pays attention to ___.', ['details', 'rumours', 'deadlines only', 'popularity'], 0],
  ['grammar', 'No sooner had she arrived ___ it began to rain.', ['when', 'while', 'than', 'since'], 2],
  ['vocab', 'The witness gave an equivocal reply, leaving her position ___.', ['certain', 'obvious', 'settled', 'ambiguous'], 3],
  ['grammar', 'The committee insisted that the report ___ revised.', ['is', 'be', 'was', 'being'], 1],
  ['vocab', 'The apparent concession was merely a ___ to delay negotiations.', ['stratagem', 'consensus', 'corollary', 'restitution'], 0],
  ['grammar', 'Were it not for your help, the project ___ impossible.', ['is', 'has been', 'would be', 'will be'], 2],
  ['vocab', 'Her laconic response was notably ___.', ['effusive', 'digressive', 'verbose', 'terse'], 3]
]

export function assessmentBank(version = 'synthetic-1') {
  return {
    version,
    items: examples.map(([skill, prompt, choices, answerIndex], index) => ({
      id: `synthetic-${String(index + 1).padStart(2, '0')}`,
      difficulty: Math.floor(index / 4) + 1,
      skill, prompt, choices: [...choices], answerIndex,
      explanation: '合成准入夹具；难度标签未作专业标定。'
    }))
  }
}
