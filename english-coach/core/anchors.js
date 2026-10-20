import { createHash } from 'node:crypto'

/**
 * The frozen anchor pool. Twelve self-authored four-choice items, each tagged
 * with an internal difficulty. Every assessment draws three of them, unmarked,
 * to watch whether the generated items drift easier or harder over months.
 *
 * Frozen means frozen: an item may be retired, never edited. Editing one would
 * silently invalidate every earlier comparison made against it.
 */
const RAW = [
  {
    id: 'anchor-01',
    difficulty: 2,
    skill: 'grammar',
    prompt: 'She ___ to school every morning.',
    choices: ['go', 'goes', 'going', 'gone'],
    answerIndex: 1,
    explanation: '一般现在时，主语是第三人称单数，动词加 -s。'
  },
  {
    id: 'anchor-02',
    difficulty: 2,
    skill: 'grammar',
    prompt: 'Which sentence is correct?',
    choices: [
      "He don't like coffee.",
      "He doesn't likes coffee.",
      "He doesn't like coffee.",
      "He not like coffee."
    ],
    answerIndex: 2,
    explanation: '否定助动词 does 已经承担了单数变化，后面的动词用原形。'
  },
  {
    id: 'anchor-03',
    difficulty: 3,
    skill: 'vocab',
    prompt: 'The meeting was ___ because the manager was ill.',
    choices: ['called off', 'called on', 'called up', 'called for'],
    answerIndex: 0,
    explanation: 'call off = 取消。'
  },
  {
    id: 'anchor-04',
    difficulty: 3,
    skill: 'grammar',
    prompt: "I'd rather you ___ tell anyone about it.",
    choices: ["don't", "didn't", 'will not', "haven't"],
    answerIndex: 1,
    explanation: "would rather + 从句用过去式，表示对现在或将来的愿望。"
  },
  {
    id: 'anchor-05',
    difficulty: 4,
    skill: 'grammar',
    prompt: 'Hardly ___ the room when the phone rang.',
    choices: ['he had entered', 'had he entered', 'did he entered', 'he entered'],
    answerIndex: 1,
    explanation: '否定副词 Hardly 置于句首时主句部分倒装：had he entered。'
  },
  {
    id: 'anchor-06',
    difficulty: 4,
    skill: 'grammar',
    prompt: 'The report, ___ was published last week, caused a stir.',
    choices: ['that', 'which', 'what', 'it'],
    answerIndex: 1,
    explanation: '非限制性定语从句只能用 which，不能用 that。'
  },
  {
    id: 'anchor-07',
    difficulty: 5,
    skill: 'grammar',
    prompt: '___ the heavy rain, the event went ahead as planned.',
    choices: ['Although', 'Despite', 'However', 'Even'],
    answerIndex: 1,
    explanation: 'Despite 后面接名词短语；Although 后面要接完整从句。'
  },
  {
    id: 'anchor-08',
    difficulty: 5,
    skill: 'grammar',
    prompt: 'She spoke ___ she had known the subject for years.',
    choices: ['as if', 'even if', 'so that', 'in case'],
    answerIndex: 0,
    explanation: 'as if = 好像，后面常用虚拟语气。'
  },
  {
    id: 'anchor-09',
    difficulty: 5,
    skill: 'vocab',
    prompt: 'The proposal was rejected on the ___ that it was too costly.',
    choices: ['grounds', 'reasons', 'causes', 'bases'],
    answerIndex: 0,
    explanation: 'on the grounds that = 以……为理由，是固定搭配。'
  },
  {
    id: 'anchor-10',
    difficulty: 6,
    skill: 'grammar',
    prompt: 'Not until the results were published ___ how serious the problem was.',
    choices: ['we realized', 'did we realize', 'we did realize', 'realized we'],
    answerIndex: 1,
    explanation: 'Not until 置句首，主句部分倒装：did we realize。'
  },
  {
    id: 'anchor-11',
    difficulty: 6,
    skill: 'vocab',
    prompt: 'His argument is ___: it assumes the very thing it sets out to prove.',
    choices: ['circular', 'circuitous', 'cyclical', 'circulating'],
    answerIndex: 0,
    explanation: 'circular argument = 循环论证。'
  },
  {
    id: 'anchor-12',
    difficulty: 6,
    skill: 'vocab',
    prompt: 'The policy was introduced ___ to reduce congestion, though few believed it.',
    choices: ['ostensibly', 'invariably', 'inevitably', 'indiscriminately'],
    answerIndex: 0,
    explanation: 'ostensibly = 表面上（声称如此），恰好对应"though few believed it"。'
  }
]

export const ANCHOR_POOL = Object.freeze(RAW.map((item) => Object.freeze({ ...item })))

/** Stable hash over the frozen pool, recorded so an edited pool is detectable. */
export function hashAnchors(items) {
  const canonical = items.map((item) => ({
    id: item.id,
    difficulty: item.difficulty,
    skill: item.skill,
    prompt: item.prompt,
    choices: item.choices,
    answerIndex: item.answerIndex
  }))
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex')
}

export const ANCHOR_HASH = hashAnchors(ANCHOR_POOL)

export function anchorStore() {
  return {
    version: 1,
    frozen: true,
    hash: ANCHOR_HASH,
    retired: [],
    items: ANCHOR_POOL.map((item) => ({ ...item }))
  }
}
