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

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { PingRequestSchema } from '@modelcontextprotocol/sdk/types.js';

export async function connectMCP() {
  const transport = new StreamableHTTPClientTransport(new URL('http://localhost:4242/mcp'));

  const client = new Client({ name: 'test', version: '1.0.0' });
  client.setRequestHandler(PingRequestSchema, async () => ({}));

  await client.connect(transport);
  await client.ping();

  const response = await client.callTool({
    name: 'browser_navigate',
    arguments: {
      url: 'https://google.com/'
    }
  });
  console.log('Navigated to Google', response.isError ? ('error:' + JSON.stringify(response.content, null, 2)) : '');

  const response2 = await client.callTool({
    name: 'browser_type',
    arguments: {
      text: 'Browser MCP',
      submit: true,
      element: 'combobox "Search" [active] [ref=e44]',
      ref: 'e44',
    }
  });
  console.log('Typed text', response2.isError ? JSON.stringify(response2.content, null, 2) : '');

  console.log('Closing browser...');
  const response3 = await client.callTool({
    name: 'browser_close',
    arguments: {}
  });
  console.log('Closed browser');
  console.log(response3.isError ? ('error' + JSON.stringify(response3.content, null, 2)) : '');

  await transport.terminateSession();
  await client.close();
  console.log('Closed MCP client');
}

void connectMCP();