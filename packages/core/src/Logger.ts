//
// Abstract logging adaptor
//
export class Logger {
  public debug(...args) {
    logger.debug(...args);
  }

  public error(...args) {
    logger.error(...args);
  }

  public info(...args) {
    logger.info(...args);
  }

  public trace(...args) {
    logger.trace(...args);
  }

  public  warn(...args) {
    logger.warn(...args);
  }
}

export let logger: Logger = console;

export function setLogger(instance: Logger) {
  logger = instance;
}
