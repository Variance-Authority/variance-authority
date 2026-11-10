// Stands in for a compiler that refuses the test file, as `ts-jest` does on a type error.
module.exports = {
  process: () => {
    throw new SyntaxError('this file does not compile');
  },
};
