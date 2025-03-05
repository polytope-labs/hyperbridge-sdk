"use strict";
// Copyright 2020-2025 SubQuery Pte Ltd authors & contributors
// SPDX-License-Identifier: GPL-3.0
Object.defineProperty(exports, "__esModule", { value: true });
const deploy_controller_1 = require("./deploy-controller");
jest.setTimeout(30000);
describe('splitMultichainDataFields test', () => {
    it('Single chain, single endpoint', () => {
        const result = (0, deploy_controller_1.splitMultichainDataFields)('chainIdididid:http://1.1.1.1');
        expect(result).toEqual({ chainIdididid: 'http://1.1.1.1' });
    });
    it('multi chain, multi endpoint', () => {
        const result = (0, deploy_controller_1.splitMultichainDataFields)('chainIdididid:http://1.1.1.1,chainIdididid222:http://2.2.2.2,chainIdididid333:http://3.3.33.3');
        expect(result).toEqual({
            chainIdididid: 'http://1.1.1.1',
            chainIdididid222: 'http://2.2.2.2',
            chainIdididid333: 'http://3.3.33.3',
        });
    });
    it('Incorrect values (endpoint without chainId)', () => {
        const result = (0, deploy_controller_1.splitMultichainDataFields)('http://2.2.2.2,http://2.2.2.3');
        expect(result).toEqual({});
    });
});
//# sourceMappingURL=deploy-controller.spec.js.map