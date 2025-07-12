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

import { debugLog } from './relayConnection.js';

import type { NativeCommand } from './nativeMessagingProtocol.js';

export class NativeMessagingClient {
  private _port: chrome.runtime.Port;

  constructor() {
    this._port = chrome.runtime.connectNative('dev.playwright.mcp');
    this._port.onMessage.addListener(async msg => {
      console.log('received: ' + JSON.stringify(msg, null, 2));
      await this._handleMessage(msg);
    });
    this._port.onDisconnect.addListener(() => {
      debugLog('Disconnected', chrome.runtime.lastError);
    });
  }

  private async _handleMessage(message: NativeCommand): Promise<void> {
    switch (message.method) {
      case 'acceptMCPConnection':
        console.log('acceptMCPConnection', message.params);

        const sendResponse = (accept: boolean) => {
          this._port.postMessage({
            id: message.id,
            result: {
              accept,
            },
          });
        };

        let tab: chrome.tabs.Tab;
        try {
          tab = await chrome.tabs.create({ url: chrome.runtime.getURL('connection-dialog.html') });
          await Promise.all([
            chrome.tabs.update(tab.id!, { active: true }),
            chrome.windows.update(tab.windowId, { focused: true }),
          ]);
        } catch (error) {
          sendResponse(false);
          return;
        }

        const tabRemovedListener = (tabId: number, removeInfo: chrome.tabs.TabRemoveInfo) => {
          if (tabId !== tab.id)
            return;
          console.log('tab removed', tabId);
          handleChoice(false);
        };
        chrome.tabs.onRemoved.addListener(tabRemovedListener);

        const messageListener = (msg: { type: string, answer: string }) => {
          if (msg.type === 'dialog-response') {
            console.log(`User responded: ${msg.answer}`);
            handleChoice(msg.answer === 'yes');
          }
        };
        chrome.runtime.onMessage.addListener(messageListener);

        function handleChoice(accept: boolean) {
          chrome.tabs.onRemoved.removeListener(tabRemovedListener);
          chrome.runtime.onMessage.removeListener(messageListener);
          sendResponse(accept);
        }

        break;

      case 'receivedChoice':
        console.log('receivedChoice', message.params);
        break;
    }
  }
}
