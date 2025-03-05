"use strict";
// Copyright 2020-2025 SubQuery Pte Ltd authors & contributors
// SPDX-License-Identifier: GPL-3.0
Object.defineProperty(exports, "__esModule", { value: true });
const tslib_1 = require("tslib");
const path_1 = tslib_1.__importDefault(require("path"));
const common_1 = require("@subql/common");
const types_ethereum_1 = require("@subql/types-ethereum");
const constants_1 = require("../constants");
const migrate_manifest_controller_1 = require("./migrate-manifest.controller");
const testProjectPath = '../../../../test/migrate/testProject';
describe('migrate manifest controller', () => {
    let subgraph;
    beforeEach(() => {
        subgraph = (0, migrate_manifest_controller_1.readSubgraphManifest)(path_1.default.join(__dirname, testProjectPath, 'subgraph.yaml'), 'mockSubgraphPath');
    });
    it(`readSubgraphManifest from a given subgraph.yaml`, () => {
        expect(subgraph.schema).toStrictEqual({ file: './schema.graphql' });
    });
    it(`subgraphDsToSubqlDs`, () => {
        const networkConverter = constants_1.networkConverters[common_1.NETWORK_FAMILY.ethereum];
        expect((0, migrate_manifest_controller_1.subgraphDsToSubqlDs)(networkConverter.dsConverter, subgraph.dataSources)[0].startBlock).toBe(7844214);
        expect((0, migrate_manifest_controller_1.subgraphDsToSubqlDs)(networkConverter.dsConverter, subgraph.dataSources)[0].kind).toBe(types_ethereum_1.EthereumDatasourceKind.Runtime);
        expect((0, migrate_manifest_controller_1.subgraphDsToSubqlDs)(networkConverter.dsConverter, subgraph.dataSources)[0].endBlock).toBeUndefined();
    });
    it(`subgraphTemplateToSubqlTemplate`, () => {
        const networkConverter = constants_1.networkConverters[common_1.NETWORK_FAMILY.ethereum];
        const testTemplateDataSource = subgraph.dataSources;
        delete testTemplateDataSource[0].source.address;
        delete testTemplateDataSource[0].source.startBlock;
        expect((0, migrate_manifest_controller_1.subgraphTemplateToSubqlTemplate)(networkConverter.templateConverter, testTemplateDataSource)[0].name).toBe('Poap');
    });
    it(`extractNetworkFromManifest, should extract network info, throw if network not same`, () => {
        const chainInfo = (0, migrate_manifest_controller_1.extractNetworkFromManifest)(subgraph);
        expect(chainInfo).toStrictEqual({ networkFamily: common_1.NETWORK_FAMILY.ethereum, chainId: '1' });
        const mockPloygonDs = { ...subgraph.dataSources[0] };
        mockPloygonDs.network = 'polygon';
        subgraph.dataSources.push(mockPloygonDs);
        expect(() => (0, migrate_manifest_controller_1.extractNetworkFromManifest)(subgraph)).toThrow(`All network values in subgraph Networks should be the same. Got mainnet,polygon`);
    });
    it(`extractNetworkFromManifest, should throw if can not determine network family from ds`, () => {
        delete subgraph.dataSources[0].kind;
        expect(() => (0, migrate_manifest_controller_1.extractNetworkFromManifest)(subgraph)).toThrow(`Subgraph dataSource kind or network not been found`);
    });
});
//# sourceMappingURL=migrate-manifest.controller.spec.js.map