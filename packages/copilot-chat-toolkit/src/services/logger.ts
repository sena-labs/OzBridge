import * as vscode from 'vscode';

/**
 * Centralized extension logger.
 *
 * Writes to both the VS Code OutputChannel and the developer console.
 * Call {@link initLogger} once in `activate()` before using other functions.
 *
 * Messages logged before `initLogger()` are buffered and flushed
 * to the channel as soon as it becomes available.
 */

let _channel: vscode.OutputChannel | undefined;
let _prefix = '[copilot-chat-toolkit]';
const _buffer: string[] = [];

/** Initialize the extension-wide logger with an OutputChannel. Call once in `activate()`. */
export function initLogger(channel: vscode.OutputChannel, prefix?: string): void {
  _channel = channel;
  if (prefix) { _prefix = prefix; }
  for (const line of _buffer) {
    _channel.appendLine(line);
  }
  _buffer.length = 0;
}

function writeLine(line: string): void {
  if (_channel) {
    _channel.appendLine(line);
  } else {
    _buffer.push(line);
  }
}

/** Log an informational message. */
export function logInfo(msg: string): void {
  const line = `${_prefix} ${msg}`;
  writeLine(line);
  console.log(line);
}

/** Log a warning. */
export function logWarn(msg: string, ...args: unknown[]): void {
  const line = `${_prefix} WARN: ${msg}`;
  writeLine(line);
  console.warn(line, ...args);
}

/** Log an error. */
export function logError(msg: string, ...args: unknown[]): void {
  const line = `${_prefix} ERROR: ${msg}`;
  writeLine(line);
  console.error(line, ...args);
}
