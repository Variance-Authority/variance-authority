import { routeCollector } from '@variance-authority/route-collector';

export default routeCollector({
  routes: { billing: 'http://localhost:5176/' },
  roots: ['main'],
});
