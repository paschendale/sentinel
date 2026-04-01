import pino from 'pino'
import { LOG_LEVEL, LOG_PRETTY } from './config.js'

/**
 * Single root logger. When `LOG_PRETTY` is true (default outside production), uses
 * pino-pretty so test runs are visible in the terminal without reading JSON.
 */
export const logger: pino.Logger = LOG_PRETTY
  ? pino({
      level: LOG_LEVEL,
      transport: {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'SYS:HH:MM:ss',
          ignore: 'pid,hostname',
          singleLine: true,
        },
      },
    })
  : pino({ level: LOG_LEVEL })
