export class Spinner {
  private interval?: Timer;
  private frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
  private i = 0;

  start(message: string) {
    process.stdout.write(`${this.frames[0]} ${message}`);
    this.interval = setInterval(() => {
      this.i = (this.i + 1) % this.frames.length;
      process.stdout.write(`\r${this.frames[this.i]} ${message}`);
    }, 80);
  }

  stop() {
    if (this.interval) {
      clearInterval(this.interval);
      process.stdout.write("\r\x1b[K");
    }
  }
}
