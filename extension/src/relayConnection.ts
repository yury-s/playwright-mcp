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

export function debugLog(...args: unknown[]): void {
  const enabled = true;
  if (enabled) {
    // eslint-disable-next-line no-console
    console.log('[Extension]', ...args);
  }
}

export type ProtocolCommand = {
  id: number;
  method: string;
  params?: any;
};

export type ProtocolResponse = {
  id?: number;
  method?: string;
  params?: any;
  result?: any;
  error?: string;
};

export interface Connection {
  onmessage?: (method: string, params: any) => Promise<void> | void;
  sendEvent(method: string, params: any): void;
  close(message?: string): void;
}

export class RelayConnection {
  private _debuggee: chrome.debugger.Debuggee;
  private _rootSessionId: string;
  private _connection: Connection;
  private _eventListener: (source: chrome.debugger.DebuggerSession, method: string, params: any) => void;
  private _detachListener: (source: chrome.debugger.Debuggee, reason: string) => void;

  constructor(tabId: number, transport: Connection) {
    this._debuggee = { tabId };
    this._rootSessionId = `pw-tab-${tabId}`;
    this._connection = transport;
    this._connection.onmessage = this._onCommand.bind(this);
    // Store listeners for cleanup
    this._eventListener = this._onDebuggerEvent.bind(this);
    this._detachListener = this._onDebuggerDetach.bind(this);
    chrome.debugger.onEvent.addListener(this._eventListener);
    chrome.debugger.onDetach.addListener(this._detachListener);
  }

  close(message?: string): void {
    chrome.debugger.onEvent.removeListener(this._eventListener);
    chrome.debugger.onDetach.removeListener(this._detachListener);
    this._connection.close(message);
  }

  async detachDebugger(): Promise<void> {
    await chrome.debugger.detach(this._debuggee);
  }

  private _onDebuggerEvent(source: chrome.debugger.DebuggerSession, method: string, params: any): void {
    if (source.tabId !== this._debuggee.tabId)
      return;
    debugLog('Forwarding CDP event:', method, params);
    const sessionId = source.sessionId || this._rootSessionId;
    this._sendEvent('forwardCDPEvent', {
      sessionId,
      method,
      params,
    });
  }

  private _onDebuggerDetach(source: chrome.debugger.Debuggee, reason: string): void {
    if (source.tabId !== this._debuggee.tabId)
      return;
    this._sendEvent('detachedFromTab', {
      tabId: this._debuggee.tabId,
      reason,
    });
  }

  private async _onCommand(method: string, params: any): Promise<any> {
    if (method === 'attachToTab') {
      debugLog('Attaching debugger to tab:', this._debuggee);
      await chrome.debugger.attach(this._debuggee, '1.3');
      const result: any = await chrome.debugger.sendCommand(this._debuggee, 'Target.getTargetInfo');
      return {
        sessionId: this._rootSessionId,
        targetInfo: result?.targetInfo,
      };
    }
    if (method === 'detachFromTab') {
      debugLog('Detaching debugger from tab:', this._debuggee);
      return await this.detachDebugger();
    }
    if (method === 'forwardCDPCommand') {
      const { sessionId, method, params: cdpParams } = params;
      debugLog('CDP command:', method, cdpParams);
      const debuggerSession: chrome.debugger.DebuggerSession = { ...this._debuggee };
      // Pass session id, unless it's the root session.
      if (sessionId && sessionId !== this._rootSessionId)
        debuggerSession.sessionId = sessionId;
      // Forward CDP command to chrome.debugger
      return await chrome.debugger.sendCommand(
          debuggerSession,
          method,
          cdpParams
      );
    }
  }

  private _sendEvent(method: string, params: any): void {
    this._connection.sendEvent(method, params);
  }
}
