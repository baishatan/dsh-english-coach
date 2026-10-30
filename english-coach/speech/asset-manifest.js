// Fixed upstream model/tokenizer/curated voices. Large weights are NOT bundled.
// SHA-256 values include the downloaded metadata bytes, not Git blob identities.
const revision = '1939ad2a8e416c0acfeecc08a694d14ef25f2231'
const repository = 'onnx-community/Kokoro-82M-v1.0-ONNX'
const files = [
  ['config.json', 44, 'df34b4f930b23447cd4dc410fabfb42eb3f24e803e6c3f97d618fb359380a36f'],
  ['onnx/model_quantized.onnx', 92361116, 'fbae9257e1e05ffc727e951ef9b9c98418e6d79f1c9b6b13bd59f5c9028a1478'],
  ['tokenizer.json', 3497, '77a02c8e164413299b4b4c403b14f8e0e1c1b727db4d46a09d6327b861060a34'],
  ['tokenizer_config.json', 113, 'be1cb066d6ef6b074b3f15e6a6dd21ac88ff3cdaedf325f0aaed686c70f75d20'],
  ['voices/af_heart.bin', 522240, 'd583ccff3cdca2f7fae535cb998ac07e9fcb90f09737b9a41fa2734ec44a8f0b'],
  ['voices/am_michael.bin', 522240, '1d1f21dd8da39c30705cd4c75d039d265e9bc4a2a93ed09bc9e1b1225eb95ba1'],
  ['voices/bf_emma.bin', 522240, '669fe0647f9dd04fcab92f1439a40eeb4c8b4ab1f82e4996fe3d918ce4a63b73'],
  ['voices/bm_george.bin', 522240, 'c4b235a4c1f2cd3b939fed08b899ce9385638b763f7b73a59616c4fc9bd6c9bc']
].map(([path, bytes, sha256]) => Object.freeze({
  path, bytes, sha256, revision,
  url: `https://huggingface.co/${repository}/resolve/${revision}/${path}`,
  license: 'Apache-2.0',
  licenseUrl: `https://huggingface.co/${repository}/blob/${revision}/README.md`
}))

export const assetManifest = Object.freeze({
  id: `kokoro-82m-v1.0-q8-${revision}`,
  model: repository, revision, dtype: 'q8',
  voices: Object.freeze(['af_heart', 'am_michael', 'bf_emma', 'bm_george']),
  files: Object.freeze(files),
  downloadBytes: 94453730,
  // Only downloaded model assets. Runtime/vendor installation is separate.
  scope: 'model-tokenizer-four-voices',
  runtimeIncluded: false
})
