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

import { stdin, stdout } from 'process';

import type { NativeResponse } from './nativeMessagingProtocol';
import { startInProcessRelay } from './cdpRelay.js';
import { debugLog } from './nativeMessagingHostLogger.js';

export class NativeMessagingHost {
  onMessage?: (message: any) => void;

  constructor() {
    let buffer = Buffer.alloc(0);
    let frameLen = -1;

    stdin.on('data', chunk => {
      buffer = Buffer.concat([buffer, chunk]);
      while (buffer.length > 0) {
        if (frameLen === -1) {
          // Wait for the frame length.
          if (buffer.length < 4)
            break;
          frameLen = buffer.readUInt32LE(0);
          buffer = buffer.subarray(4);
        }
        // Wait for the full frame body.
        if (buffer.length < frameLen)
          break;
        // Read the frame body.
        const messageBuffer = buffer.subarray(0, frameLen);
        // debugLog('Received: ' + messageBuffer.toString());
        buffer = buffer.subarray(frameLen);
        try {
          const message = JSON.parse(messageBuffer.toString());
          this.onMessage?.(message);
        } catch (error: any) {
          this.sendMessage({ error: `Failed to parse message: ${error.message}` });
        }
        frameLen = -1; // reset to get next data
      }
    });

    stdin.on('end', () => {
      process.exit(0);
    });

    debugLog('NativeMessagingHost created');
  }

  sendMessage(message: any): void {
    const messageString = JSON.stringify(message);
    const messageBuffer = Buffer.from(messageString);
    const headerBuffer = Buffer.alloc(4);
    headerBuffer.writeUInt32LE(messageBuffer.length, 0);
    stdout.write(Buffer.concat([headerBuffer, messageBuffer]), err => {
      if (!err)
        return;
      process.exit(2);
    });
    // debugLog('Sent: ' + messageString);
  }
}

export class NativeConnection {
  private _lastId = 1;
  private _transport: NativeMessagingHost;
  private readonly _callbacks = new Map<number, { resolve: (o: any) => void, reject: (e: Error) => void }>();

  constructor(host: NativeMessagingHost) {
    this._transport = host;
    host.onMessage = (message: any) => this._handleMessage(message);
  }

  private _handleMessage(message: NativeResponse): void {
    const callback = this._callbacks.get(message.id)!;
    this._callbacks.delete(message.id);
    if (message.error)
      callback.reject(new Error(message.error));
    else
      callback.resolve(message.result);
  }

  async send(method: string, params: any): Promise<any> {
    const id = this._lastId++;
    const promise = new Promise((resolve, reject) => {
      this._callbacks.set(id, { resolve, reject });
    });
    this._transport.sendMessage({ id, method, params });
    return promise;
  }
}

void startInProcessRelay().catch(e => {
  console.error(e);
  process.exit(1);
});
