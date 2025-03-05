"use strict";
// Copyright 2020-2025 SubQuery Pte Ltd authors & contributors
// SPDX-License-Identifier: GPL-3.0
Object.defineProperty(exports, "__esModule", { value: true });
const tslib_1 = require("tslib");
const fs_1 = tslib_1.__importDefault(require("fs"));
const path_1 = tslib_1.__importDefault(require("path"));
const common_1 = require("@subql/common");
const common_cosmos_1 = require("@subql/common-cosmos");
const lodash_1 = require("lodash");
const rimraf_1 = require("rimraf");
const utils_1 = require("../utils");
const PROJECT_PATH = path_1.default.join(__dirname, '../../test/protoTest1');
const MOCK_CHAINTYPES = {
    'osmosis.gamm.v1beta1': {
        file: './proto/osmosis/gamm/v1beta1/tx.proto',
        messages: ['MsgSwapExactAmountIn'],
    },
    'osmosis.poolmanager.v1beta1': {
        file: './proto/osmosis/poolmanager/v1beta1/swap_route.proto',
        messages: ['SwapAmountInRoute'],
    },
};
jest.setTimeout(30000);
describe('Able to generate cosmos types from protobuf', () => {
    afterEach(async () => {
        await (0, rimraf_1.rimraf)(path_1.default.join(__dirname, '../../test/protoTest1/src'));
    });
    const manifest = (0, common_1.loadFromJsonOrYaml)(path_1.default.join(PROJECT_PATH, 'project.yaml'));
    it('Able to generate ts types from protobufs', async () => {
        const expectedGeneratedCode = '' +
            `// SPDX-License-Identifier: Apache-2.0

// Auto-generated , DO NOT EDIT
import {CosmosMessage} from "@subql/types-cosmos";

import * as OsmosisGammV1beta1Tx from "./proto-interfaces/osmosis/gamm/v1beta1/tx";


export namespace osmosis.gamm.v1beta1.tx {

  export type MsgSwapExactAmountInMessage = CosmosMessage<OsmosisGammV1beta1Tx.MsgSwapExactAmountIn>;
}

`;
        manifest.network.chaintypes = MOCK_CHAINTYPES;
        await (0, common_cosmos_1.projectCodegen)([manifest], PROJECT_PATH, utils_1.prepareDirPath, utils_1.renderTemplate, lodash_1.upperFirst, []);
        const codegenResult = await fs_1.default.promises.readFile(path_1.default.join(PROJECT_PATH, '/src/types/CosmosMessageTypes.ts'));
        expect(fs_1.default.existsSync(`${PROJECT_PATH}/src/types/CosmosMessageTypes.ts`)).toBeTruthy();
        expect(codegenResult.toString()).toBe(expectedGeneratedCode);
    });
    it('On missing protobuf dependency should throw', async () => {
        const badChainType = {
            'osmosis.gamm.v1beta1': {
                file: './proto/cosmos/osmosis/gamm/v1beta1/tx.proto',
                messages: ['MsgSwapExactAmountIn'],
            },
        };
        manifest.network.chaintypes = badChainType;
        await expect(() => (0, common_cosmos_1.projectCodegen)([manifest], PROJECT_PATH, utils_1.prepareDirPath, utils_1.renderTemplate, lodash_1.upperFirst, [])).rejects.toThrow('Failed to generate from protobufs. Error: chainType osmosis.gamm.v1beta1, file ./proto/cosmos/osmosis/gamm/v1beta1/tx.proto does not exist');
    });
});
//# sourceMappingURL=codegen-cosmos.test.js.map