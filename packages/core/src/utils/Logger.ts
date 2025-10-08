export const enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
  NONE = 4
}

export class Logger {
  private static level: LogLevel = LogLevel.WARN;

  private constructor() {}

  static setLevel(level: LogLevel): void {
    this.level = level;
  }

  static debug(...args: unknown[]): void {
    if (this.level <= LogLevel.DEBUG) {
      console.log(...args);
    }
  }

  static info(...args: unknown[]): void {
    if (this.level <= LogLevel.INFO) {
      console.log(...args);
    }
  }

  static warn(...args: unknown[]): void {
    if (this.level <= LogLevel.WARN) {
      console.warn(...args);
    }
  }

  static error(...args: unknown[]): void {
    if (this.level <= LogLevel.ERROR) {
      console.error(...args);
    }
  }
}
