import { routeCollector } from '@variance-authority/route-collector';

// Every .html file under ./site becomes one subject. `roots` narrows each page
// to its <main>, so a change to the surrounding chrome is not attributed to it.
export default routeCollector({
  directory: './site',
  roots: ['main'],
});
