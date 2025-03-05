"use strict";
// Copyright 2020-2025 SubQuery Pte Ltd authors & contributors
// SPDX-License-Identifier: GPL-3.0
Object.defineProperty(exports, "__esModule", { value: true });
exports.isProjectSpecV0_0_1 = isProjectSpecV0_0_1;
exports.isProjectSpecV0_2_0 = isProjectSpecV0_2_0;
exports.isProjectSpecV1_0_0 = isProjectSpecV1_0_0;
function isProjectSpecV0_0_1(projectSpec) {
    return !isProjectSpecV0_2_0(projectSpec);
}
function isProjectSpecV0_2_0(projectSpec) {
    return !!projectSpec.genesisHash;
}
function isProjectSpecV1_0_0(projectSpec) {
    return !!projectSpec.chainId;
}
//# sourceMappingURL=types.js.map