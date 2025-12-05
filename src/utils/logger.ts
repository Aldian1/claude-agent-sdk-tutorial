/**
 * Simple logger utility with log levels
 * Debug logs only show when DEBUG env var is set
 */

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

class Logger {
  private isDebugEnabled: boolean;

  constructor() {
    this.isDebugEnabled = process.env.DEBUG === 'true' || process.env.DEBUG === '1';
  }

  private formatMessage(level: LogLevel, message: string, ...args: any[]): string {
    const timestamp = new Date().toISOString();
    const levelUpper = level.toUpperCase().padEnd(5);
    
    // Color codes for terminal
    const colors = {
      debug: '\x1b[36m',   // Cyan
      info: '\x1b[32m',    // Green
      warn: '\x1b[33m',    // Yellow
      error: '\x1b[31m',   // Red
      reset: '\x1b[0m',
      dim: '\x1b[2m',
    };

    const color = colors[level];
    const reset = colors.reset;
    const dim = colors.dim;

    // Format the message
    let formatted = `${dim}[${timestamp}]${reset} ${color}${levelUpper}${reset} ${message}`;

    // Add additional args if present
    if (args.length > 0) {
      const argsStr = args.map(arg => 
        typeof arg === 'object' ? JSON.stringify(arg, null, 2) : String(arg)
      ).join(' ');
      formatted += ` ${dim}${argsStr}${reset}`;
    }

    return formatted;
  }

  debug(message: string, ...args: any[]): void {
    if (this.isDebugEnabled) {
      console.log(this.formatMessage('debug', message, ...args));
    }
  }

  info(message: string, ...args: any[]): void {
    console.log(this.formatMessage('info', message, ...args));
  }

  warn(message: string, ...args: any[]): void {
    console.warn(this.formatMessage('warn', message, ...args));
  }

  error(message: string, ...args: any[]): void {
    console.error(this.formatMessage('error', message, ...args));
  }

  /**
   * Enable or disable debug logging
   */
  setDebug(enabled: boolean): void {
    this.isDebugEnabled = enabled;
  }
}

// Export singleton instance
export const logger = new Logger();

// Export class for testing
export { Logger };

