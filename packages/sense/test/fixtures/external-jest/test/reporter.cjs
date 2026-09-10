// The project's own reporter, which withTestSelection must leave in place.
const { writeFileSync } = require('node:fs');

module.exports = class MarkReporter {
  constructor(_globalConfig, options) {
    this.mark = options.mark;
  }

  onRunComplete() {
    writeFileSync(this.mark, 'ran\n');
  }
};
