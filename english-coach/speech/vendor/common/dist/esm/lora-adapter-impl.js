// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
import { resolveBackendForLoraAdapter } from './backend-impl.js';
import { TRACE_FUNC_BEGIN, TRACE_FUNC_END } from './trace.js';
export class LoraAdapter {
    constructor(backend, handler) {
        this.backend = backend;
        this.handler = handler;
    }
    static async create(uriOrBuffer) {
        TRACE_FUNC_BEGIN();
        if (typeof uriOrBuffer !== 'string' && !(uriOrBuffer instanceof Uint8Array)) {
            throw new TypeError("Unexpected argument[0]: must be 'path' or 'buffer'.");
        }
        const backend = await resolveBackendForLoraAdapter();
        const handler = await backend.createLoraAdapterHandler(uriOrBuffer);
        TRACE_FUNC_END();
        return new LoraAdapter(backend, handler);
    }
    async release() {
        return this.handler.dispose();
    }
}
//# sourceMappingURL=lora-adapter-impl.js.map