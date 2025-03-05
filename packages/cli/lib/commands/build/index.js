"use strict";
// Copyright 2020-2025 SubQuery Pte Ltd authors & contributors
// SPDX-License-Identifier: GPL-3.0
Object.defineProperty(exports, "__esModule", { value: true });
const tslib_1 = require("tslib");
const assert_1 = tslib_1.__importDefault(require("assert"));
const fs_1 = require("fs");
const path_1 = tslib_1.__importDefault(require("path"));
const core_1 = require("@oclif/core");
const build_controller_1 = require("../../controller/build-controller");
const utils_1 = require("../../utils");
class Build extends core_1.Command {
    static description = 'Build this SubQuery project code';
    static flags = {
        location: core_1.Flags.string({ char: 'f', description: 'local folder or manifest file to run build' }),
        output: core_1.Flags.string({ char: 'o', description: 'output folder of build e.g. dist' }),
        mode: core_1.Flags.string({ options: ['production', 'prod', 'development', 'dev'], default: 'production' }),
        silent: core_1.Flags.boolean({ char: 's', description: 'silent mode' }),
    };
    async run() {
        try {
            const { flags } = await this.parse(Build);
            const location = flags.location ? (0, utils_1.resolveToAbsolutePath)(flags.location) : process.cwd();
            const isDev = flags.mode === 'development' || flags.mode === 'dev';
            (0, assert_1.default)((0, fs_1.existsSync)(location), 'Argument `location` is not a valid directory or file');
            const directory = (0, fs_1.lstatSync)(location).isDirectory() ? location : path_1.default.dirname(location);
            const tsManifest = (0, utils_1.getTsManifest)(location);
            if (tsManifest) {
                await (0, utils_1.buildManifestFromLocation)(tsManifest, flags.silent
                    ? () => {
                        /* No-op */
                    }
                    : this.log.bind(this));
            }
            const buildEntries = (0, build_controller_1.getBuildEntries)(directory);
            const outputDir = path_1.default.resolve(directory, flags.output ?? 'dist');
            await (0, build_controller_1.runWebpack)(buildEntries, directory, outputDir, isDev, true);
            if (!flags.silent) {
                this.log('Building and packing code ...');
                this.log('Done!');
            }
        }
        catch (e) {
            this.error(e);
        }
    }
}
exports.default = Build;
//# sourceMappingURL=index.js.map