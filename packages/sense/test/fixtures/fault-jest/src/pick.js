function checked(value) {
  if (value > 0) {
    return 'positive';
  }
  return 'other';
}

function unchecked(log, value) {
  if (value > 0) {
    log.push(value);
  }
  return log;
}

module.exports = { checked, unchecked };
