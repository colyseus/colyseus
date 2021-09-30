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
}

