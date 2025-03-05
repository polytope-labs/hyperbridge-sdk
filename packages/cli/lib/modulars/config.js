"use strict";
// Copyright 2020-2025 SubQuery Pte Ltd authors & contributors
// SPDX-License-Identifier: GPL-3.0
Object.defineProperty(exports, "__esModule", { value: true });
exports.networkPackages = void 0;
const common_1 = require("@subql/common");
exports.networkPackages = {
    [common_1.NETWORK_FAMILY.algorand]: '@subql/common-algorand',
    [common_1.NETWORK_FAMILY.concordium]: '@subql/common-concordium',
    [common_1.NETWORK_FAMILY.cosmos]: '@subql/common-cosmos',
    [common_1.NETWORK_FAMILY.ethereum]: '@subql/common-ethereum',
    [common_1.NETWORK_FAMILY.near]: '@subql/common-near',
    [common_1.NETWORK_FAMILY.stellar]: '@subql/common-stellar',
    [common_1.NETWORK_FAMILY.substrate]: '@subql/common-substrate',
    [common_1.NETWORK_FAMILY.starknet]: '@subql/common-starknet',
};
//# sourceMappingURL=config.js.map