/**
 * Copyright (c) Microsoft Corporation.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * Bridge Server - Standalone WebSocket server that bridges Playwright MCP and Chrome Extension
 *
 * Endpoints:
 * - /cdp - Full CDP interface for Playwright MCP
 * - /extension - Extension connection for chrome.debugger forwarding
 */

/* eslint-disable no-console */

import * as websocket from 'ws';
import { NativeMessagingHost } from './nativeMessagingHost.js';
import { debugLog } from './nativeMessagingHostLogger.js';
import http from 'node:http';
import assert from 'node:assert';

import { startMCPServer } from '../../lib/transport.js';

import type { AddressInfo } from 'node:net';

type CDPCommand = {
  id: number;
  sessionId?: string;
  method: string;
  params?: any;
};

type CDPResponse = {
  id?: number;
  sessionId?: string;
  method?: string;
  params?: any;
  result?: any;
  error?: { code?: number; message: string };
};

export class CDPRelayServer {
  private _wss: websocket.WebSocketServer;
  private _playwrightSocket: websocket.WebSocket | null = null;
  private _extensionConnection: ExtensionConnection | null = null;
  private _connectionInfo: {
    targetInfo: any;
    // Page sessionId that should be used by this connection.
    sessionId: string;
  } | undefined;
  private readonly _cdpPath: string;

  constructor(server: http.Server, extensionConnection: ExtensionConnection, secureCdpPath: string) {
    this._cdpPath = secureCdpPath;
    this._wss = new websocket.WebSocketServer({ server, verifyClient: this._verifyCDPPath.bind(this) });
    this._wss.on('connection', this._onConnection.bind(this));
    this._extensionConnection = extensionConnection;
    this._extensionConnection.onclose = c => {
      if (this._extensionConnection === c)
        this._extensionConnection = null;
    };
    this._extensionConnection.onmessage = this._handleExtensionMessage.bind(this);
    debugLog('CDP Relay Server started ' + httpAddressToString(server.address()));
  }

  stop(): void {
    this._playwrightSocket?.close();
    this._extensionConnection?.close();
  }

  private async _verifyCDPPath(info: { origin: string; secure: boolean; req: http.IncomingMessage }, callback: (res: boolean, httpStatusCode?: number, message?: string) => void) {
    debugLog('Verifying client', info.req.url);
    if (info.req.url !== this._cdpPath) {
      callback(false, 404, `Unknown path: ${info.req.url}`);
      return;
    }
    callback(true);
  }

  private _onConnection(ws: websocket.WebSocket, request: http.IncomingMessage) {
    debugLog(`New connection to ${request.url}`);
    // Must be synchronous as WebSocketServer does not buffer incoming messages.
    this._acceptPlaywrightConnection(ws);
  }

  private _acceptPlaywrightConnection(ws: websocket.WebSocket): void {
    if (this._playwrightSocket?.readyState === websocket.WebSocket.OPEN) {
      debugLog('Closing previous Playwright connection');
      this._playwrightSocket.close(1000, 'New connection established');
    }
    this._playwrightSocket = ws;
    debugLog('Playwright MCP connected');
    ws.on('message', async data => {
      try {
        const message = JSON.parse(data.toString());
        await this._handlePlaywrightMessage(message);
      } catch (error) {
        debugLog('Error parsing Playwright message:', error);
      }
    });
    ws.on('close', () => {
      if (this._playwrightSocket === ws) {
        void this._detachDebugger();
        this._playwrightSocket = null;
      }
      debugLog('Playwright MCP disconnected');
    });
    ws.on('error', error => {
      debugLog('Playwright WebSocket error:', error);
    });
  }

  private async _detachDebugger() {
    this._connectionInfo = undefined;
    await this._extensionConnection?.send('detachFromTab', {});
  }

  private _handleExtensionMessage(method: string, params: any) {
    switch (method) {
      case 'forwardCDPEvent':
        this._sendToPlaywright({
          sessionId: params.sessionId,
          method: params.method,
          params: params.params
        });
        break;
      case 'detachedFromTab':
        debugLog('← Debugger detached from tab:', params);
        this._connectionInfo = undefined;
        this._extensionConnection?.close();
        this._extensionConnection = null;
        break;
    }
  }

  private async _handlePlaywrightMessage(message: CDPCommand): Promise<void> {
    debugLog('← Playwright:', `${message.method} (id=${message.id})`);
    if (!this._extensionConnection) {
      debugLog('Extension not connected, sending error to Playwright');
      this._sendToPlaywright({
        id: message.id,
        error: { message: 'Extension not connected' }
      });
      return;
    }
    if (await this._interceptCDPCommand(message))
      return;
    await this._forwardToExtension(message);
  }

  private async _interceptCDPCommand(message: CDPCommand): Promise<boolean> {
    switch (message.method) {
      case 'Browser.getVersion': {
        this._sendToPlaywright({
          id: message.id,
          result: {
            protocolVersion: '1.3',
            product: 'Chrome/Extension-Bridge',
            userAgent: 'CDP-Bridge-Server/1.0.0',
          }
        });
        return true;
      }
      case 'Browser.setDownloadBehavior': {
        this._sendToPlaywright({
          id: message.id
        });
        return true;
      }
      case 'Target.setAutoAttach': {
        // Simulate auto-attach behavior with real target info
        if (!message.sessionId) {
          this._connectionInfo = await this._extensionConnection!.send('attachToTab');
          debugLog('Simulating auto-attach for target:', message);
          this._sendToPlaywright({
            method: 'Target.attachedToTarget',
            params: {
              sessionId: this._connectionInfo!.sessionId,
              targetInfo: {
                ...this._connectionInfo!.targetInfo,
                attached: true,
              },
              waitingForDebugger: false
            }
          });
          this._sendToPlaywright({
            id: message.id
          });
        } else {
          await this._forwardToExtension(message);
        }
        return true;
      }
      case 'Target.getTargetInfo': {
        debugLog('Target.getTargetInfo', message);
        this._sendToPlaywright({
          id: message.id,
          result: this._connectionInfo?.targetInfo
        });
        return true;
      }
    }
    return false;
  }

  private async _forwardToExtension(message: CDPCommand): Promise<void> {
    try {
      if (!this._extensionConnection)
        throw new Error('Extension not connected');
      const { id, sessionId, method, params } = message;
      const result = await this._extensionConnection.send('forwardCDPCommand', { sessionId, method, params });
      this._sendToPlaywright({ id, sessionId, result });
    } catch (e) {
      debugLog('Error in the extension:', e);
      this._sendToPlaywright({
        id: message.id,
        sessionId: message.sessionId,
        error: { message: (e as Error).message }
      });
    }
  }

  private _sendToPlaywright(message: CDPResponse): void {
    debugLog('→ Playwright:', `${message.method ?? `response(id=${message.id})`}`);
    this._playwrightSocket?.send(JSON.stringify(message));
  }
}

class ExtensionConnection {
  private readonly _transport: NativeMessagingHost;
  private readonly _callbacks = new Map<number, { resolve: (o: any) => void, reject: (e: Error) => void }>();
  private _lastId = 0;

  onmessage?: (method: string, params: any) => void;
  onclose?: (self: ExtensionConnection) => void;

  constructor(ws: NativeMessagingHost) {
    this._transport = ws;
    this._transport.onMessage = this._handleParsedMessage.bind(this);
  }

  async send(method: string, params?: any, sessionId?: string): Promise<any> {
    const id = ++this._lastId;
    this._transport.sendMessage({ id, method, params, sessionId });
    return new Promise((resolve, reject) => {
      this._callbacks.set(id, { resolve, reject });
    });
  }

  close(message?: string) {
    debugLog('closing extension connection:', message);
    // this._ws.close(1000, message ?? 'Connection closed');
    this.onclose?.(this);
  }

  private _handleParsedMessage(object: any) {
    if (object.id && this._callbacks.has(object.id)) {
      const callback = this._callbacks.get(object.id)!;
      this._callbacks.delete(object.id);
      if (object.error)
        callback.reject(new Error(object.error.message));
      else
        callback.resolve(object.result);
    } else if (object.id) {
      debugLog('← Extension: unexpected response', object);
    } else {
      this.onmessage?.(object.method, object.params);
    }
  }

  private _onClose(event: websocket.CloseEvent) {
    debugLog(`<ws closed> code=${event.code} reason=${event.reason}`);
    this._dispose();
  }


  private _dispose() {
    for (const callback of this._callbacks.values())
      callback.reject(new Error('WebSocket closed'));
    this._callbacks.clear();
  }
}

function httpAddressToString(address: string | AddressInfo | null): string {
  assert(address, 'Could not bind server socket');
  if (typeof address === 'string')
    return address;
  const resolvedPort = address.port;
  let resolvedHost = address.family === 'IPv4' ? address.address : `[${address.address}]`;
  if (resolvedHost === '0.0.0.0' || resolvedHost === '[::]')
    resolvedHost = 'localhost';
  return `http://${resolvedHost}:${resolvedPort}`;
}


export async function startHttpServer(config: { host?: string, port?: number }): Promise<http.Server> {
  const { host, port } = config;
  const httpServer = http.createServer();
  await new Promise<void>((resolve, reject) => {
    httpServer.on('error', reject);
    httpServer.listen(port, host, () => {
      resolve();
      httpServer.removeListener('error', reject);
    });
  });
  return httpServer;
}

export async function startInProcessRelay() {
  const httpServer = await startHttpServer({ port: 9225 });
  const extensionConnection = new ExtensionConnection(new NativeMessagingHost());
  const cdpPath = '/cdp/' + crypto.randomUUID();
  const server = new CDPRelayServer(httpServer, extensionConnection, cdpPath);
  debugLog('Started CDP server');
  const cdpEndpoint = httpAddressToString(httpServer.address()).replace(/^http/, 'ws') + cdpPath;
  debugLog('CDP endpoint:', cdpEndpoint);
  await startMCPServer({
    port: 4242,
    cdpEndpoint,
    extension: true,
  }, async (req: http.IncomingMessage) => {
    const { accept } = await extensionConnection.send('acceptMCPConnection', {
      userAgent: req.headers['user-agent'],
    });
    return accept;
  });
  debugLog('Started MCP server inline');
  return server;
}
