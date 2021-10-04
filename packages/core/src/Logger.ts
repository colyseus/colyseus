//
// Abstract logging adaptor
//
export class Logger {
  private static _instance: any;

  private constructor() {}

  public static getLogger() {
    if(!Logger._instance) {
      Logger._instance = console;
    }
    return Logger._instance;
  }

  public static setLogger(logger: any) {
    Logger._instance = logger;
  }

  public static debug(...args) {
    Logger._instance.debug(...args);
  }

  public static error(...args) {
    Logger._instance.error(args);
  }

  public static info(...args) {
    Logger._instance.info(...args);
  }

  public static trace(...args) {
    Logger._instance.trace(...args);
  }

  public static warn(...args) {
    Logger._instance.warn(...args);
  }
}

