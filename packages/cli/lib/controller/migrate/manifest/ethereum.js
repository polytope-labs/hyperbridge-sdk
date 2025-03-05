"use strict";
// Copyright 2020-2025 SubQuery Pte Ltd authors & contributors
// SPDX-License-Identifier: GPL-3.0
Object.defineProperty(exports, "__esModule", { value: true });
exports.convertEthereumDs = convertEthereumDs;
exports.convertEthereumTemplate = convertEthereumTemplate;
const generate_controller_1 = require("../../generate-controller");
function baseDsConversion(ds) {
    const assets = new Map();
    for (const abi of ds.mapping.abis) {
        assets.set(abi.name, { file: abi.file });
    }
    const subqlDs = {
        kind: 'ethereum/Runtime',
        migrateDatasourceType: 'EthereumDatasourceKind.Runtime',
        assets: new Map(ds.mapping.abis.map((a) => [a.name, { file: a.file }])),
        mapping: {
            file: generate_controller_1.DEFAULT_HANDLER_BUILD_PATH,
            handlers: [
                ...(ds.mapping.blockHandlers ?? []).map((h) => {
                    return {
                        kind: 'ethereum/Runtime',
                        migrateHandlerType: 'EthereumHandlerKind.Block',
                        handler: h.handler,
                        filter: undefined,
                    };
                }),
                ...(ds.mapping.eventHandlers ?? []).map((h) => {
                    return {
                        kind: 'ethereum/LogHandler',
                        migrateHandlerType: 'EthereumHandlerKind.Event',
                        handler: h.handler,
                        filter: {
                            topics: [h.event],
                        },
                    };
                }),
                ...(ds.mapping.callHandlers ?? []).map((h) => {
                    return {
                        kind: 'ethereum/TransactionHandler',
                        migrateHandlerType: 'EthereumHandlerKind.Call',
                        handler: h.handler,
                        filter: {
                            f: h.function,
                        },
                    };
                }),
            ],
        },
    };
    return subqlDs;
}
function convertEthereumDs(ds) {
    const subqlDs = baseDsConversion(ds);
    subqlDs.startBlock = ds.source.startBlock;
    subqlDs.endBlock = ds.source.endBlock;
    subqlDs.options = { abi: ds.source.abi, address: ds.source.address };
    return subqlDs;
}
function convertEthereumTemplate(ds) {
    const subqlTemplate = baseDsConversion(ds);
    subqlTemplate.options = { abi: ds.source.abi };
    subqlTemplate.name = ds.name;
    return subqlTemplate;
}
//# sourceMappingURL=ethereum.js.map