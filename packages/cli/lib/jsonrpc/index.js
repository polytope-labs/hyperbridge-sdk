"use strict";
// Copyright 2020-2025 SubQuery Pte Ltd authors & contributors
// SPDX-License-Identifier: GPL-3.0
Object.defineProperty(exports, "__esModule", { value: true });
exports.getGenesisHash = getGenesisHash;
const client_1 = require("./client");
async function getGenesisHash(endpoint) {
    const client = endpoint.startsWith('ws') ? new client_1.WsJsonRpcClient(endpoint) : new client_1.HttpJsonRpcClient(endpoint);
    const genesisBlock = await client.send('chain_getBlockHash', [0]);
    client.destroy?.();
    return genesisBlock;
}
//# sourceMappingURL=index.js.map