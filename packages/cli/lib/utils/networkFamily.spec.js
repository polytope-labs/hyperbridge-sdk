"use strict";
// Copyright 2020-2025 SubQuery Pte Ltd authors & contributors
// SPDX-License-Identifier: GPL-3.0
Object.defineProperty(exports, "__esModule", { value: true });
const common_1 = require("@subql/common");
const networkFamily_1 = require("./networkFamily");
describe('Get network family', () => {
    it('convert input to right network family', () => {
        expect((0, networkFamily_1.getNetworkFamily)('ethereum')).toBe(common_1.NETWORK_FAMILY.ethereum);
        expect((0, networkFamily_1.getNetworkFamily)('Ethereum')).toBe(common_1.NETWORK_FAMILY.ethereum);
        expect(() => (0, networkFamily_1.getNetworkFamily)('fakeNetwork')).toThrow(`Network not found or unsupported network fakeNetwork`);
    });
});
//# sourceMappingURL=networkFamily.spec.js.map