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

import { FullConfig } from './config.js';
import { Context } from './context.js';
import { logUnhandledError } from './log.js';
import { Response } from './response.js';
import { SessionLog } from './sessionLog.js';
import { filteredTools } from './tools.js';
import { packageJSON } from './package.js';
import { ConnectTool } from './extension/connect_tool.js';

import type { BrowserContextFactory } from './browserContextFactory.js';
import type * as mcpServer from './mcp/server.js';
import type { ServerBackend } from './mcp/server.js';
import type { Tool } from './tools/tool.js';

let num = 1;

export class BrowserServerBackend implements ServerBackend {
  name = 'Playwright';
  version = packageJSON.version;

  private _tools: Tool[];
  private _context: Context | undefined;
  private _sessionLog: SessionLog | undefined;
  private _config: FullConfig;
  private _browserContextFactory: BrowserContextFactory;
  id = num++;

  constructor(config: FullConfig, browserContextFactory: BrowserContextFactory) {
    this._config = config;
    this._browserContextFactory = browserContextFactory;
    this._tools = filteredTools(config);
  }

  async initialize(switchBackend: (newBackend: ServerBackend) => void) {
    this._sessionLog = this._config.saveSession ? await SessionLog.create(this._config) : undefined;
    this._tools.push(new ConnectTool(switchBackend));
    this._context = new Context(this._tools, this._config, this._browserContextFactory, this._sessionLog);
  }

  tools(): mcpServer.ToolSchema<any>[] {
    return this._tools.map(tool => tool.schema);
  }

  async callTool(schema: mcpServer.ToolSchema<any>, parsedArguments: any) {
    const context = this._context!;
    const response = new Response(context, schema.name, parsedArguments);
    const tool = this._tools.find(tool => tool.schema.name === schema.name)!;
    context.setRunningTool(true);
    try {
      await tool.handle(context, parsedArguments, response);
      await response.finish();
      this._sessionLog?.logResponse(response);
    } catch (error: any) {
      response.addError(String(error));
    } finally {
      context.setRunningTool(false);
    }
    return response.serialize();
  }

  serverInitialized(version: mcpServer.ClientVersion | undefined) {
    this._context!.clientVersion = version;
  }

  serverClosed() {
    void this._context!.dispose().catch(logUnhandledError);
  }
}
