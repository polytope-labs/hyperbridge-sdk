"use strict";
// Copyright 2020-2025 SubQuery Pte Ltd authors & contributors
// SPDX-License-Identifier: GPL-3.0
Object.defineProperty(exports, "__esModule", { value: true });
const tslib_1 = require("tslib");
const assert_1 = tslib_1.__importDefault(require("assert"));
const path_1 = tslib_1.__importDefault(require("path"));
const core_1 = require("@oclif/core");
const common_1 = require("@subql/common");
const publish_controller_1 = require("../controller/publish-controller");
const utils_1 = require("../utils");
const build_1 = tslib_1.__importDefault(require("./build"));
class Publish extends core_1.Command {
    static description = 'Upload this SubQuery project to IPFS';
    static flags = {
        location: core_1.Flags.string({ char: 'f', description: 'from project folder or specify manifest file' }),
        ipfs: core_1.Flags.string({ description: 'IPFS gateway endpoint', required: false }),
        output: core_1.Flags.boolean({ char: 'o', description: 'Output IPFS CID', required: false }),
    };
    async run() {
        const { flags } = await this.parse(Publish);
        const location = flags.location ? (0, utils_1.resolveToAbsolutePath)(flags.location) : process.cwd();
        try {
            await build_1.default.run(['--location', location, '-s']);
        }
        catch (e) {
            this.log(e);
            this.error('Failed to build project');
        }
        // Make sure build first, generated project yaml could be added to the project (instead of ts)
        const project = (0, common_1.getProjectRootAndManifest)(location);
        const authToken = await (0, utils_1.checkToken)();
        const fullPaths = project.manifests.map((manifest) => path_1.default.join(project.root, manifest));
        let multichainManifestPath = (0, common_1.getMultichainManifestPath)(location);
        if (multichainManifestPath) {
            multichainManifestPath = path_1.default.join(project.root, multichainManifestPath);
        }
        const fileToCidMap = await (0, publish_controller_1.uploadToIpfs)(fullPaths, authToken.trim(), multichainManifestPath, flags.ipfs).catch((e) => {
            // log further cause from error
            if (e.cause) {
                console.error(e.cause);
            }
            return this.error(e);
        });
        await Promise.all(project.manifests.map((manifest) => {
            const cid = fileToCidMap.get(manifest);
            (0, assert_1.default)(cid, `CID for ${manifest} not found`);
            return (0, publish_controller_1.createIPFSFile)(project.root, manifest, cid);
        }));
        const directoryCid = Array.from(fileToCidMap).find(([file]) => file === '');
        if (!flags.output) {
            if (directoryCid) {
                this.log(`SubQuery Multichain Project uploaded to IPFS: ${directoryCid[1]}`);
            }
            fileToCidMap.forEach((cid, file) => {
                if (file !== '') {
                    this.log(`${directoryCid ? '- This includes' : 'SubQuery Project'} ${file} uploaded to IPFS: ${cid}`);
                }
            });
        }
        else {
            if (directoryCid) {
                this.log(directoryCid[1]);
            }
            else {
                fileToCidMap.forEach((cid, file) => {
                    if (file !== '') {
                        this.log(cid);
                    }
                });
            }
        }
    }
}
exports.default = Publish;
//# sourceMappingURL=publish.js.map