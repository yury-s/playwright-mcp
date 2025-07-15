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

import { debugLog, RelayConnection, Connection } from './relayConnection.js';

import type { NativeCommand, NativeResponse } from './nativeMessagingProtocol.js';

export class NativeMessagingClient implements Connection {
  private _connect: (tabId: number, connection: RelayConnection) => Promise<void>;
  private _port: chrome.runtime.Port;

  constructor(connect: (tabId: number, connection: RelayConnection) => Promise<void>) {
    this._connect = connect;
    this._port = chrome.runtime.connectNative('dev.playwright.mcp');
    this._port.onMessage.addListener(async msg => {
      await this._handleCommand(msg);
    });
    this._port.onDisconnect.addListener(() => {
      debugLog('Disconnected', chrome.runtime.lastError);
    });
  }

  onmessage?: (method: string, params: any) => Promise<void> | void;

  sendEvent(method: string, params: any): void {
    this._port.postMessage({
      method,
      params,
    });
  }

  close(reason?: string): void {
    this.sendEvent('didCloseMCPConnection', { reason });
  }

  private async _handleCommand(message: NativeCommand): Promise<void> {
    const response: NativeResponse = {
      id: message.id,
    };
    try {
      response.result = await this._handleMessage(message.method, message.params);
    } catch (e: any) {
      response.error = e.message;
    }
    this._port.postMessage(response);
  }

  private async _handleMessage(method: string, params: any): Promise<any> {
    switch (method) {
      case 'acceptMCPConnection':
        const accept = await this._acceptMCPConnection(params);
        return { accept };

      case 'logToConsole':
        console.log('logToConsole', params);
        return;

      default:
        // Forward to the tab.
        if (this.onmessage)
          return await this.onmessage(method, params);
        throw new Error('No native messaging transport');
    }
  }

  private async _acceptMCPConnection(params: any): Promise<boolean> {
    let tab: chrome.tabs.Tab;
    try {
      tab = await chrome.tabs.create({ url: chrome.runtime.getURL('connection-dialog.html') });
      await Promise.all([
        chrome.tabs.update(tab.id!, { active: true }),
        chrome.windows.update(tab.windowId, { focused: true }),
      ]);
    } catch (error) {
      return false ;
    }

    let resolveChoice: (accept: boolean) => void;
    const acceptPromise = new Promise<boolean>(resolve => {
      resolveChoice = resolve;
    });

    const tabRemovedListener = (tabId: number, removeInfo: chrome.tabs.TabRemoveInfo) => {
      if (tabId !== tab.id)
        return;
      resolveChoice(false);
    };
    chrome.tabs.onRemoved.addListener(tabRemovedListener);

    const messageListener = (msg: { type: string, answer: string }) => {
      if (msg.type === 'dialog-response')
        resolveChoice(msg.answer === 'yes');
    };
    chrome.runtime.onMessage.addListener(messageListener);

    try {
      let accept = await acceptPromise;
      if (accept) {
        try {
          await this._connect(tab.id!, new RelayConnection(tab.id!, this));
        } catch (error) {
          accept = false;
        }
      }
      return accept;
    } finally {
      chrome.tabs.onRemoved.removeListener(tabRemovedListener);
      chrome.runtime.onMessage.removeListener(messageListener);
    }
  }
}
