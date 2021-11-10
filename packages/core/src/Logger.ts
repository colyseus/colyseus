//
// Abstract logging adaptor
//
export class Logger {
  debug(...args) {
    logger.debug(...args);
  }

  error(...args) {
    logger.error(...args);
  }

  info(...args) {
    logger.info(...args);
  }

  trace(...args) {
    logger.trace(...args);
  }

  warn(...args) {
    logger.warn(...args);
  }
}

export let logger: Logger = console;

export function setLogger(instance: Logger) {
  logger = instance;
}
