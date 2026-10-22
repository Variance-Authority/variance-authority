const { add } = require('./add.cjs');

function twice(n) {
  return add(n, n);
}

module.exports = { twice };
