"use strict";
// Copyright 2020-2025 SubQuery Pte Ltd authors & contributors
// SPDX-License-Identifier: GPL-3.0
Object.defineProperty(exports, "__esModule", { value: true });
exports.migrateAbis = migrateAbis;
const tslib_1 = require("tslib");
const fs_1 = tslib_1.__importDefault(require("fs"));
const path_1 = tslib_1.__importDefault(require("path"));
const lodash_1 = require("lodash");
const generate_controller_1 = require("../../generate-controller");
function extractAllAbiFiles(dataSources) {
    return (0, lodash_1.uniqWith)(dataSources.flatMap((dataSource) => dataSource.mapping.abis.map((abi) => abi.file).filter(Boolean)));
}
async function copyAbiFilesToTargetPathAsync(abiFiles, targetPath) {
    try {
        await Promise.all(abiFiles.map((file) => {
            const fileName = path_1.default.basename(file);
            const targetFilePath = path_1.default.join(targetPath, fileName);
            fs_1.default.promises.copyFile(file, targetFilePath);
        }));
        console.log(`ABI files used in project manifest copied successfully, please copy other required ABI files to ${targetPath}`);
    }
    catch (error) {
        console.error('Error copying ABI files:', error);
    }
}
async function migrateAbis(subgraphManifest, subgraphDir, subqlDir) {
    const abiPaths = extractAllAbiFiles(subgraphManifest.dataSources);
    const resolvedPaths = abiPaths.map((p) => path_1.default.join(subgraphDir, p));
    const targetAbiDir = path_1.default.join(subqlDir, generate_controller_1.DEFAULT_ABI_DIR);
    await copyAbiFilesToTargetPathAsync(resolvedPaths, targetAbiDir);
}
//# sourceMappingURL=migrate-abis.controller.js.map