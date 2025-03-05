"use strict";
// Copyright 2020-2025 SubQuery Pte Ltd authors & contributors
// SPDX-License-Identifier: GPL-3.0
Object.defineProperty(exports, "__esModule", { value: true });
exports.migrateMapping = migrateMapping;
const tslib_1 = require("tslib");
const fs_1 = tslib_1.__importDefault(require("fs"));
const path_1 = tslib_1.__importDefault(require("path"));
const utils_1 = require("../../../utils");
async function migrateMapping(subgraphDir, subqlDir) {
    const subqlSrcPath = path_1.default.join(subqlDir, '/src');
    await fs_1.default.promises.rm(subqlSrcPath, { force: true, recursive: true });
    // copy over src
    (0, utils_1.copyFolderSync)(path_1.default.join(subgraphDir, '/src'), subqlSrcPath);
    console.log(`* Mapping handlers have been copied over, they will need to be updated to work with SubQuery. See our documentation for more details https://academy.subquery.network/build/graph-migration.html#codegen`);
}
//# sourceMappingURL=migrate-mapping.controller.js.map