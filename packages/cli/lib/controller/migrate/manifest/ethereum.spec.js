"use strict";
// Copyright 2020-2025 SubQuery Pte Ltd authors & contributors
// SPDX-License-Identifier: GPL-3.0
Object.defineProperty(exports, "__esModule", { value: true });
const types_ethereum_1 = require("@subql/types-ethereum");
const migrate_fixtures_1 = require("../migrate.fixtures");
const ethereum_1 = require("./ethereum");
describe('migrate eth manifest', () => {
    it(`convertEthereumDs`, () => {
        const testSubgraph = migrate_fixtures_1.TestSubgraph;
        const subqlDs = testSubgraph.dataSources.map((ds) => (0, ethereum_1.convertEthereumDs)(ds));
        expect(subqlDs.length).toBe(1);
        expect(subqlDs[0].kind).toBe(types_ethereum_1.EthereumDatasourceKind.Runtime);
        expect(subqlDs[0].migrateDatasourceType).toBe('EthereumDatasourceKind.Runtime');
        expect(subqlDs[0].options).toStrictEqual({ abi: 'Poap', address: '0x22C1f6050E56d2876009903609a2cC3fEf83B415' });
        expect(subqlDs[0].mapping.handlers[0].migrateHandlerType).toStrictEqual('EthereumHandlerKind.Event');
        expect(subqlDs[0].mapping.handlers[0].handler).toStrictEqual('handleEventToken');
        expect(subqlDs[0].mapping.handlers[0].filter).toStrictEqual({ topics: ['EventToken(uint256,uint256)'] });
        // converted handler should in same order
        expect(subqlDs[0].mapping.handlers[1].handler).toStrictEqual('handleTransfer');
    });
    it(`convertEthereumTemplate`, () => {
        const testTemplateDataSource = migrate_fixtures_1.TestSubgraph.dataSources;
        delete testTemplateDataSource[0].source.address;
        delete testTemplateDataSource[0].source.startBlock;
        const subqlTemplate = (0, ethereum_1.convertEthereumTemplate)(testTemplateDataSource[0]);
        expect(subqlTemplate.options?.address).toBeUndefined();
        expect(subqlTemplate.options?.abi).toBe('Poap');
        expect(subqlTemplate.assets?.get('Poap')).toBeTruthy();
    });
});
//# sourceMappingURL=ethereum.spec.js.map