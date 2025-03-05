"use strict";
// Copyright 2020-2025 SubQuery Pte Ltd authors & contributors
// SPDX-License-Identifier: GPL-3.0
Object.defineProperty(exports, "__esModule", { value: true });
exports.WsJsonRpcClient = void 0;
const websocket_1 = require("websocket");
let id = 0;
class WsJsonRpcClient {
    address;
    static async with(url, callback) {
        const client = new WsJsonRpcClient(url);
        await client.isReady;
        const ret = await callback(client);
        client.destroy();
        return ret;
    }
    isReady;
    _ws;
    isDestroyed = false;
    handlers;
    constructor(address) {
        this.address = address;
        this.handlers = {};
        this.connect();
    }
    connect() {
        try {
            this._ws = new websocket_1.w3cwebsocket(this.address);
            this.isReady = new Promise((resolve) => {
                this._ws.onopen = () => resolve(this);
            });
            this._ws.onclose = this.onSocketClose;
            this._ws.onmessage = this.onSocketMessage;
        }
        catch (error) {
            console.error(error);
        }
    }
    async send(method, params) {
        await this.isReady;
        const req = { jsonrpc: '2.0', id: id++, method, params };
        this._ws.send(JSON.stringify(req));
        return new Promise((resolve, reject) => {
            this.handlers[req.id] = [resolve, reject];
        });
    }
    destroy() {
        this.isDestroyed = true;
        this._ws.close();
    }
    onSocketClose = (event) => {
        if (this.isDestroyed)
            return;
        console.error(`disconnected from ${this.address} code: '${event.code}' reason: '${event.reason}'`);
        setTimeout(() => {
            this.connect();
        }, 1000);
    };
    onSocketMessage = ({ data: dataStr }) => {
        try {
            const data = JSON.parse(String(dataStr));
            if (data.id !== undefined && data.id !== null && this.handlers[data.id]) {
                const [resolve, reject] = this.handlers[data.id];
                delete this.handlers[data.id];
                if (data.error) {
                    reject(data.error);
                }
                else {
                    resolve(data.result);
                }
            }
        }
        catch (e) {
            console.error(e);
        }
    };
}
exports.WsJsonRpcClient = WsJsonRpcClient;
//# sourceMappingURL=ws.js.map