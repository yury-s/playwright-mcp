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

import { createConnection as createConnectionImpl } from './connection.js';
import type { Connection } from '../index.js';
import { resolveConfig } from './config.js';
import { contextFactory as defaultContextFactory } from './browserContextFactory.js';

import type { Config } from '../config.js';
import type { BrowserContextFactory } from './browserContextFactory.js';

export type { BrowserContextFactory };

export async function createConnection(userConfig: Config = {}, contextFactory?: BrowserContextFactory): Promise<Connection> {
  const config = await resolveConfig(userConfig);
  const factory = contextFactory ?? defaultContextFactory(config.browser);
  return createConnectionImpl(config, factory);
}
