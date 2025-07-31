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

import { z } from 'zod';
import { ServerBackend } from '../mcp/server.js';
import { BrowserServerBackend } from '../browserServerBackend.js';
import { startCDPRelayServer } from './cdpRelay.js';
import { Context } from '../context.js';
import { Response } from '../response.js';

export class ConnectTool {
  capability = 'core' as const;

  schema = {
    name: 'browser_connect_extension',
    title: 'Connect to the default browser profile',
    description: 'Connect to the default browser profile. Requires Playwright MCP to be running.',
    inputSchema: z.object({}),
    type: 'destructive' as const,
  };

  private _backendSwitcher: (newBackend: ServerBackend) => void;
  private _backend: BrowserServerBackend | undefined;

  constructor(backendSwitcher: (newBackend: ServerBackend) => void) {
    this._backendSwitcher = backendSwitcher;
  }

  async handle(context: Context, params: any, response: Response) {
    // const tab = await context.ensureTab();
    console.log('connect_tool called');
    const backend = await this._ensureExtensionBackend(context);
    this._backendSwitcher(backend);
    response.addResult('Successfully connected to the MCP extension.');
    console.log('connect_tool done');
  };

  private async _ensureExtensionBackend(context: Context) {
    if (!this._backend) {
      const abortController = new AbortController();
      const contextFactory = await startCDPRelayServer(context.config.browser.launchOptions.channel || 'chrome', abortController);

      this._backend = new BrowserServerBackend(context.config, contextFactory);
      this._backend.onclose = () => {
        contextFactory.clientDisconnected();
        this._backend = undefined;
      };
      this._backend.initialize(this._backendSwitcher);
      this._backend.serverInitialized?.({
        name: 'extension backend',
        version: '0.0.1',
      });
    }
    return this._backend;
  }
}
