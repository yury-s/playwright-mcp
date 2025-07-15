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

import { debugLog, ProtocolCommand, ProtocolResponse, RelayConnection, Transport } from './relayConnection.js';

import type { NativeCommand } from './nativeMessagingProtocol.js';

export class NativeMessagingClient {
  private _connect: (tabId: number, connection: RelayConnection) => Promise<void>;
  private _port: chrome.runtime.Port;
  private _nativeMessagingTransport: NativeMessagingTransport | null = null;

  constructor(connect: (tabId: number, connection: RelayConnection) => Promise<void>) {
    this._connect = connect;
    this._port = chrome.runtime.connectNative('dev.playwright.mcp');
    this._port.onMessage.addListener(async msg => {
      await this._handleMessage(msg);
    });
    this._port.onDisconnect.addListener(() => {
      debugLog('Disconnected', chrome.runtime.lastError);
    });
  }

  private async _handleMessage(message: NativeCommand): Promise<void> {
    console.log('_handleMessage', message.method);
    switch (message.method) {
      case 'acceptMCPConnection':
        await this._handleAcceptMCPConnection(message);
        break;

      case 'logToConsole':
        console.log('logToConsole', message.params);
        this._port.postMessage({
          id: message.id,
        });
        // for (let i = 0; i < 10; i++) {
        //   this._port.postMessage({
        //     method: 'foo',
        //   });
        // }
        console.log('logToConsole replied: ', message.id);
        break;

      default:
        // Forward to the tab.
        if (this._nativeMessagingTransport?.onmessage) {
          await this._nativeMessagingTransport.onmessage(message);
        } else {
          this._port.postMessage({
            id: message.id,
            error: 'No native messaging transport',
          });
        }
        break;
    }
  }

  private async _handleAcceptMCPConnection(message: NativeCommand): Promise<void> {
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
      void handleChoice(false);
    };
    chrome.tabs.onRemoved.addListener(tabRemovedListener);

    const messageListener = (msg: { type: string, answer: string }) => {
      if (msg.type === 'dialog-response')
        void handleChoice(msg.answer === 'yes');
    };
    chrome.runtime.onMessage.addListener(messageListener);

    const handleChoice = async (accept: boolean) => {
      chrome.tabs.onRemoved.removeListener(tabRemovedListener);
      chrome.runtime.onMessage.removeListener(messageListener);
      if (accept) {
        try {
          this._nativeMessagingTransport = new NativeMessagingTransport(this._port);
          await this._connect(tab.id!, new RelayConnection(tab.id!, this._nativeMessagingTransport));
        } catch (error) {
          accept = false;
          this._nativeMessagingTransport = null;
        }
      }
      sendResponse(accept);
    };
  }
}

class NativeMessagingTransport implements Transport {
  private _port: chrome.runtime.Port;

  onmessage?: (command: ProtocolCommand) => Promise<void> | void;

  constructor(port: chrome.runtime.Port) {
    this._port = port;
  }

  send(message: ProtocolResponse): void {
    this._port.postMessage(message);
  }

  close(message?: string): void {
    this._port.postMessage({
      method: 'didCloseMCPConnection',
      params: {
        reason: message,
      },
    });
  }
}
