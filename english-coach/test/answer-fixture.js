import { execute } from '../core/index.js'

let serial = 0
export const roundIdentity = batch => ({ roundId: batch.round.id, revision: batch.round.revision, presentationId: batch.round.current?.id })

// Existing rule tests call out real, separate attempts explicitly. No request
// interception is used by production Client tests or the identity/replay tests.
export async function answerFixture(root, payload, now) {
  const options = { now }
  const independent = await execute(root, 'review.answer', { ...payload, attemptId: `fixture-attempt-${++serial}` }, options)
  if (independent.code !== 'answer_identity_required') return independent
  const current = await execute(root, 'study.batch', {}, options)
  if (!current.ok) return current
  let batch = current.data
  if (batch.round.status === 'active') {
    if (batch.round.current?.feedback) {
      const next = await execute(root, 'study.next', roundIdentity(batch), options)
      if (!next.ok) return next
      batch = next.data
    }
    if (batch.round.current?.itemId === payload.itemId) {
      return execute(root, 'review.answer', { ...payload, ...roundIdentity(batch) }, options)
    }
  }
  return execute(root, 'review.answer', { ...payload, attemptId: `fixture-attempt-${++serial}` }, options)
}
