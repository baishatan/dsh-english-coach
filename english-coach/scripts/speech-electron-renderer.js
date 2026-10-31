// Legacy admission fixture for a new test page only; executes in Chromium, not in Node.
// Not a product runtime, current-Profile test, or audio-quality admission; playback is muted.
window.__admissionResult = (async () => {
  const response = await fetch('/audio', { cache: 'no-store' })
  if (response.status !== 200) throw new Error(`Unexpected audio status ${response.status}`)
  if (response.headers.get('content-type') !== 'audio/wav') throw new Error('WAV MIME was not preserved')
  if (response.headers.get('cache-control') !== 'no-store') throw new Error('Audio must be no-store')
  const bytes = await response.arrayBuffer()
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  const sha256 = [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join('')
  let binary = ''
  for (const value of new Uint8Array(bytes)) binary += String.fromCharCode(value)
  const result = { origin: location.origin, bytes: bytes.byteLength, sha256,
    requireType: typeof require, processType: typeof process, secureContext: isSecureContext,
    mime: response.headers.get('content-type'), cacheControl: response.headers.get('cache-control'),
    base64: btoa(binary) }
  document.getElementById('status').textContent = `Received ${result.bytes} bytes through the real protocol. Muted.`
  return result
})()
