// A preset that names the only transformer that can read this project, as `ts-jest` does.
module.exports = { transform: { '\\.ts$': '<rootDir>/strip-types.cjs' } };
