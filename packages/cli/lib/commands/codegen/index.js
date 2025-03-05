"use strict";
// Copyright 2020-2025 SubQuery Pte Ltd authors & contributors
// SPDX-License-Identifier: GPL-3.0
Object.defineProperty(exports, "__esModule", { value: true });
const core_1 = require("@oclif/core");
const common_1 = require("@subql/common");
const codegen_controller_1 = require("../../controller/codegen-controller");
const utils_1 = require("../../utils");
class Codegen extends core_1.Command {
    static description = 'Generate schemas for graph node';
    static flags = {
        location: core_1.Flags.string({
            char: 'l',
            description: '[deprecated] local folder to run codegen in. please use file flag instead',
        }),
        file: core_1.Flags.string({ char: 'f', description: 'specify manifest file path (will overwrite -l if both used)' }),
    };
    async run() {
        const { flags } = await this.parse(Codegen);
        this.log('===============================');
        this.log('---------Subql Codegen---------');
        this.log('===============================');
        const { file, location } = flags;
        const projectPath = (0, utils_1.resolveToAbsolutePath)(file ?? location ?? process.cwd());
        /*
          ts manifest can be either single chain ts manifest
          or multichain ts manifest
          or multichain yaml manifest containing single chain ts project paths
        */
        const tsManifest = (0, utils_1.getTsManifest)(projectPath);
        if (tsManifest) {
            await (0, utils_1.buildManifestFromLocation)(tsManifest, this.log.bind(this));
        }
        const { manifests, root } = (0, common_1.getProjectRootAndManifest)(projectPath);
        let firstSchemaPath = null;
        for (const manifest of manifests) {
            const schemaPath = (0, common_1.getSchemaPath)(root, manifest);
            if (firstSchemaPath === null) {
                firstSchemaPath = schemaPath;
            }
            else if (schemaPath !== firstSchemaPath) {
                throw new Error('All schema paths are not the same');
            }
        }
        try {
            await (0, codegen_controller_1.codegen)(root, manifests);
        }
        catch (err) {
            console.error(err.message, err.cause);
            process.exit(1);
        }
    }
}
exports.default = Codegen;
//# sourceMappingURL=index.js.map