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

import debug from 'debug';
import * as playwright from 'playwright';
import type { BrowserContextFactory } from '../browserContextFactory.js';
import { startHttpServer } from '../httpServer.js';
import { CDPRelayServer } from './cdpRelay.js';

const debugLogger = debug('pw:mcp:relay');

export class ExtensionContextFactory implements BrowserContextFactory {
  private _browserChannel: string;
  private _abortController: AbortController;
  private _abortSignal: AbortSignal;
  private _relayPromise: Promise<CDPRelayServer> | undefined;
  private _browserPromise: Promise<playwright.Browser> | undefined;

  constructor(browserChannel: string, abortSignal: AbortSignal) {
    this._browserChannel = browserChannel;
    this._abortController = new AbortController();
    this._abortSignal = AbortSignal.any([abortSignal, this._abortController.signal]);
  }

  async createContext(clientInfo: { name: string, version: string }): Promise<{ browserContext: playwright.BrowserContext, close: () => Promise<void> }> {
    // First call will establish the connection to the extension.
    if (!this._browserPromise)
      this._browserPromise = this._obtainBrowser(clientInfo);
    const browser = await this._browserPromise;
    return {
      browserContext: browser.contexts()[0],
      close: async () => {
        debugLogger('close() called for browser context');
        await browser.close();
        this._browserPromise = undefined;
      }
    };
  }

  dispose() {
    this._abortController.abort('Extension context factory disposed');
    this._browserPromise = undefined;
  }

  private async _obtainBrowser(clientInfo: { name: string, version: string }): Promise<playwright.Browser> {
    if (!this._relayPromise)
      this._relayPromise = this._startRelay();
    const relay = await this._relayPromise;

    this._abortSignal.throwIfAborted();
    await relay.ensureExtensionConnectionForMCPContext(clientInfo);
    const browser = await playwright.chromium.connectOverCDP(relay.cdpEndpoint());
    browser.on('disconnected', () => {
      this._browserPromise = undefined;
      debugLogger('Browser disconnected');
    });
    return browser;
  }

  private async _startRelay() {
    const httpServer = await startHttpServer({});
    const cdpRelayServer = new CDPRelayServer(httpServer, this._browserChannel);
    debugLogger(`CDP relay server started, extension endpoint: ${cdpRelayServer.extensionEndpoint()}.`);
    if (this._abortSignal.aborted)
      cdpRelayServer.stop();
    else
      this._abortSignal.addEventListener('abort', () => cdpRelayServer.stop());
    return cdpRelayServer;
  }
}
