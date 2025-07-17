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

// @ts-check

import child_process from 'child_process';
import path from 'path';

/**
 * @typedef {{
 *   files: string,
 *   from: string,
 *   to: string,
 *   ignored?: string[],
 * }} CopyFile
 */

/**
 * @typedef {{
 *   inputs: string[],
 *   mustExist?: string[],
 *   cwd?: string,
 * }} BaseOnChange
 */

/**
 * @typedef {BaseOnChange & {
 *   command: string,
 *   args?: string[],
 * }} CommandOnChange
 */

/**
 * @typedef {BaseOnChange & {
 *   script: string,
 * }} ScriptOnChange
 */

/**
 * @typedef {CommandOnChange|ScriptOnChange} OnChange
 */

/** @type {(() => void)[]} */
const disposables = [];
/** @type {Step[]} */
const steps = [];

const watchMode = process.argv.slice(2).includes('--watch');
const ROOT = import.meta.dirname;

/**
 * @param {string} relative
 * @returns {string}
 */
function filePath(relative) {
  return path.join(ROOT, ...relative.split('/'));
}

/**
 * @param {string} path
 * @returns {string}
 */
function quotePath(path) {
  return "\"" + path + "\"";
}

class Step {
  /**
   * @param {{
   *   concurrent?: boolean,
   * }} options
   */
  constructor(options) {
    this.concurrent = options.concurrent;
  }

  async run() {
    throw new Error('Not implemented');
  }
}

class ProgramStep extends Step {
  /**
   * @param {{
   *   command: string,
   *   args: string[],
   *   shell: boolean,
   *   env?: NodeJS.ProcessEnv,
   *   cwd?: string,
   *   concurrent?: boolean,
   * }} options
   */
  constructor(options) {
    super(options);
    this._options = options;
  }

  /** @override */
  async run() {
    const step = this._options;
    console.log(`==== Running ${step.command} ${step.args.join(' ')} in ${step.cwd || process.cwd()}`);
    const child = child_process.spawn(step.command, step.args, {
      stdio: 'inherit',
      shell: step.shell,
      env: {
        ...process.env,
        ...step.env
      },
      cwd: step.cwd,
    });
    disposables.push(() => {
      if (child.exitCode === null)
        child.kill();
    });
    return new Promise((resolve, reject) => {
      child.on('close', (code, signal) => {
        if (code || signal)
          reject(new Error(`'${step.command} ${step.args.join(' ')}' exited with code ${code}, signal ${signal}`));
        else
          resolve({ });
      });
    });
  }
}

async function runWatch() {
  for (const step of steps) {
    if (!step.concurrent)
      await step.run();
  }

  for (const step of steps) {
    if (step.concurrent)
      step.run().catch(e => console.error(e));
  }
}

async function runBuild() {
  for (const step of steps)
    await step.run();
}

if (watchMode) {
  // Run TypeScript for type checking.
  steps.push(new ProgramStep({
    command: 'npx',
    args: ['tsc', ...(watchMode ? ['-w'] : []), '--preserveWatchOutput', '-p', quotePath(filePath('.'))],
    shell: true,
    concurrent: true,
  }));
  for (const subproject of ['extension/crx', 'extension/mcp-server']) {
    steps.push(new ProgramStep({
      command: 'npx',
      args: ['tsc', ...(watchMode ? ['-w'] : []), '--preserveWatchOutput', '-p', quotePath(filePath(`${subproject}`))],
      shell: true,
      concurrent: true,
    }));
  }
}

let cleanupCalled = false;
function cleanup() {
  if (cleanupCalled)
    return;
  cleanupCalled = true;
  for (const disposable of disposables) {
    try {
      disposable();
    } catch (e) {
      console.error('Error during cleanup:', e);
    }
  }
}
process.on('exit', cleanup);
process.on('SIGINT', () => {
  cleanup();
  process.exit(0);
});

watchMode ? runWatch() : runBuild();
