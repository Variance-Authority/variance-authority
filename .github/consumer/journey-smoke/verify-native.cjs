const native = require('@variance-authority/sense-linux-x64-gnu');

for (const name of ['foldJourneyTo', 'stitchJourneysTo']) {
  if (typeof native[name] !== 'function') {
    throw new Error(`the published Linux addon does not export ${name}`);
  }
}

console.log('published Linux addon loaded with journey fold and stitch support');

