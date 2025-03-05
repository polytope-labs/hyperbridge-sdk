"use strict";
// Copyright 2020-2025 SubQuery Pte Ltd authors & contributors
// SPDX-License-Identifier: GPL-3.0
Object.defineProperty(exports, "__esModule", { value: true });
exports.getNetworkFamily = getNetworkFamily;
exports.findRunnerByNetworkFamily = findRunnerByNetworkFamily;
const common_1 = require("@subql/common");
const lowerCaseFirst = (str) => str.charAt(0).toLowerCase() + str.slice(1);
function isNetwork(network) {
    return !!network && lowerCaseFirst(network) in common_1.NETWORK_FAMILY;
}
// can be either lowerCased or UpperCased
function getNetworkFamily(network) {
    if (!isNetwork(network)) {
        throw new Error(`Network not found or unsupported network ${network}`);
    }
    return common_1.NETWORK_FAMILY[lowerCaseFirst(network)];
}
function findRunnerByNetworkFamily(networkFamily) {
    for (const [key, value] of Object.entries(common_1.runnerMapping)) {
        if (value === networkFamily) {
            return key;
        }
    }
    throw new Error(`Runner not found for network family ${networkFamily}`);
}
//# sourceMappingURL=networkFamily.js.map