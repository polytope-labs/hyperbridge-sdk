"use strict";
// Copyright 2020-2025 SubQuery Pte Ltd authors & contributors
// SPDX-License-Identifier: GPL-3.0
Object.defineProperty(exports, "__esModule", { value: true });
const common_1 = require("@subql/common");
const utils_1 = require("../utils");
describe('Tests for validate, CLI', () => {
    it('ensure EnumValidator', () => {
        expect((0, utils_1.isValidEnum)(common_1.NETWORK_FAMILY, 'Cosmos')).toBe(true);
        expect((0, utils_1.isValidEnum)(common_1.NETWORK_FAMILY, 'bad')).toBe(false);
    });
});
//# sourceMappingURL=validate.spec.js.map