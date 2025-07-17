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

import { program } from 'commander';

import { Connection, createConnection } from '../../../index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { startCDPRelayServer } from './cdpRelay.js';


program
    .description('Starts the MCP server that connects to a running browser instance (Edge/Chrome only). Requires the \'Playwright MCP\' browser extension to be installed.')
    .option('--pin <pin>', 'Optional pin to show in the browser when MCP is connecting to it.')
    .action(async options => {
      let connection: Connection | null = null;
      const cdpEndpoint = await startCDPRelayServer({
        port: 9225,
        pin: options.pin,
        getClientInfo: () => connection!.server.getClientVersion()!
      });

      connection = await createConnection({
        browser: {
          // Point CDP endpoint to the relay server.
          cdpEndpoint,
          browserName: 'chromium',
        },
      });
      await connection.server.connect(new StdioServerTransport());
    });

void program.parseAsync(process.argv);
