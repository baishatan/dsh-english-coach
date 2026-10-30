import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'

// Private admission helper, shared by the token-parity and real-audio probes.
export async function loadWordG2p(accent, ort) {
  assert.ok(['us', 'gb'].includes(accent))
  const exported = JSON.parse(await fs.readFile(new URL('export-summary.json', import.meta.url)))
  const base = new URL(`exports/${accent}/`, import.meta.url)
  const bytes = await fs.readFile(new URL('g2p.onnx', base))
  assert.equal(createHash('sha256').update(bytes).digest('hex'),
    exported.rows.find(row => row.accent === accent).graphSha256)
  const meta = JSON.parse(await fs.readFile(new URL('metadata.json', base)))
  assert.equal(meta.maxLength, 64)
  assert.equal(meta.vocabSize, 63)
  const index = new Map([...meta.graphemes].map((char, i) => [char, i]))
  const encode = word => {
    assert.ok(typeof word === 'string' && /^[A-Za-z'.-]{1,62}$/.test(word), 'Use one English word of 1–62 characters')
    return [meta.bosId, ...[...word].map(char => index.get(char) ?? meta.unknownId), meta.eosId]
  }
  const started = performance.now()
  const session = await ort.InferenceSession.create(bytes, {
    executionProviders: ['wasm'], enableCpuMemArena: false, enableMemPattern: false
  })
  assert.deepEqual(session.inputNames, ['input_ids', 'decoder_input_ids'])
  assert.deepEqual(session.outputNames, ['logits'])
  return { encode, graphBytes: bytes.length, loadMs: performance.now() - started,
    release: () => session.release(),
    async generate(word) {
      const input = encode(word), generated = [meta.startId]
      while (generated.length < meta.maxLength) {
        const { logits } = await session.run({
          input_ids: new ort.Tensor('int64', BigInt64Array.from(input, BigInt), [1, input.length]),
          decoder_input_ids: new ort.Tensor('int64', BigInt64Array.from(generated, BigInt), [1, generated.length])
        })
        assert.deepEqual(logits.dims, [1, generated.length, meta.vocabSize])
        const offset = (generated.length - 1) * meta.vocabSize
        let token = 0
        for (let i = 0; i < meta.vocabSize; i++) {
          assert.ok(Number.isFinite(logits.data[offset + i]))
          if (logits.data[offset + i] > logits.data[offset + token]) token = i
        }
        // Match generation_config's forced EOS at the bounded last step.
        if (generated.length === meta.maxLength - 1) token = meta.forcedEosId
        assert.ok(token < meta.phonemes.length, 'Reject unmapped output slots')
        generated.push(token)
        if (token === meta.eosId) break
      }
      assert.equal(generated.at(-1), meta.eosId)
      return { ids: generated, phonemes: generated.filter(id => id > 3).map(id => meta.phonemes[id]).join('') }
    }
  }
}
