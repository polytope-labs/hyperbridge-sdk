"use strict";
// Copyright 2020-2025 SubQuery Pte Ltd authors & contributors
// SPDX-License-Identifier: GPL-3.0
Object.defineProperty(exports, "__esModule", { value: true });
const tslib_1 = require("tslib");
const assert_1 = tslib_1.__importDefault(require("assert"));
const prompts_1 = require("@inquirer/prompts");
const core_1 = require("@oclif/core");
const add_chain_controller_1 = require("../../controller/add-chain-controller");
const utils_1 = require("../../utils");
class MultiChainAdd extends core_1.Command {
    static description = 'Add new chain manifest to multi-chain configuration';
    static flags = {
        multichain: core_1.Flags.string({ char: 'f', description: 'specify multichain manifest file path', default: process.cwd() }),
        chainManifestPath: core_1.Flags.string({ char: 'c', description: 'path to the new chain manifest' }),
    };
    async run() {
        const { flags } = await this.parse(MultiChainAdd);
        const { multichain } = flags;
        let { chainManifestPath } = flags;
        if (!chainManifestPath) {
            chainManifestPath = await (0, prompts_1.input)({ message: 'Enter the path to the new chain manifest' });
        }
        (0, assert_1.default)(chainManifestPath, 'Chain manifest path is required');
        await (0, add_chain_controller_1.addChain)(multichain, (0, utils_1.resolveToAbsolutePath)(chainManifestPath));
    }
}
exports.default = MultiChainAdd;
//# sourceMappingURL=add.js.map