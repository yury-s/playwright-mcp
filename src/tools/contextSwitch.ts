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
import { FactoryList } from '../browserServerBackend.js';
import { Response } from '../response.js';
import { BrowserContextFactory } from '../browserContextFactory.js';
import { Context } from '../context.js';

export class ContextSwitchTool {
  capability = 'core' as const;

  schema = {
    name: 'browser_connect',
    title: 'Connect to a browser context',
    description: 'Connect to a browser using one of the available methods',
    inputSchema: z.object({
      // method
    }),
    type: 'destructive' as const,
  };

  private _factories: FactoryList;
  private _onChange: (newFactory: BrowserContextFactory) => void;

  constructor(factories: FactoryList, onChange: (newFactory: BrowserContextFactory) => void) {
    this._factories = factories;
    this._onChange = onChange;

    this.schema.description = [
      'Connect to a browser using one of the available methods:',
      ...this._factories.map(factory => `- "${factory.name}": ${factory.description}`),
    ].join('\n');
    this.schema.inputSchema = z.object({
      method: z.enum(this._factories.map(factory => factory.name) as [string, ...string[]]).default(this._factories[0].name),
    });
  }

  async handle(context: Context, params: any, response: Response) {
    const factory = this._factories.find(factory => factory.name === params.method);
    if (!factory) {
      response.addError('Unknown connection method: ' + params.method);
      return;
    }
    await this._onChange(factory.factory);
    response.addResult('Successfully changed connection method.');
  }
}
