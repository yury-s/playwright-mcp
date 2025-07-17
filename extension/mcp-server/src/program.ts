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

import { createConnection } from '../../../index.js';
// import { startCDPRelayServer } from '../../../src/cdpRelay.js';

program
    .command('extension')
    .description('Starts the MCP server that connects to a running browser instance (Edge/Chrome only). Requires the \'Playwright MCP\' browser extension to be installed.')
    .option('--pin <pin>', 'Optional pin to show in the browser when MCP is connecting to it.')
    .action(async options => {
      console.log('options', options);
      const connection = await createConnection({
        browser: {
          browserName: 'chromium',
        },
      });
      console.log('connection', !!connection);
    });

void program.parseAsync(process.argv);
