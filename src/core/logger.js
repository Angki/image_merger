/**
 * Logger — Simple debug logger with levels and timestamps.
 * 
 * Usage:
 *   import { Logger } from './logger.js';
 *   const log = new Logger('ModuleName');
 *   log.info('message');
 *   log.debug('detail', { data });
 *   log.warn('warning');
 *   log.error('error', err);
 */

const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };

export class Logger {
  /** @param {string} module - Module/component name for log prefix */
  constructor(module = 'App') {
    this._module = module;
    this._level = LEVELS.debug;
  }

  /** Set minimum log level: 'debug' | 'info' | 'warn' | 'error' */
  setLevel(level) {
    if (level in LEVELS) this._level = LEVELS[level];
  }

  /** @private */
  _log(level, args) {
    if (LEVELS[level] < this._level) return;
    const ts = new Date().toISOString().slice(11, 23);
    const prefix = `[${ts}] [${level.toUpperCase()}] [${this._module}]`;
    const method = level === 'error' ? 'error' : level === 'warn' ? 'warn' : 'log';
    console[method](prefix, ...args);
  }

  debug(...args) { this._log('debug', args); }
  info(...args)  { this._log('info', args); }
  warn(...args)  { this._log('warn', args); }
  error(...args) { this._log('error', args); }
}
