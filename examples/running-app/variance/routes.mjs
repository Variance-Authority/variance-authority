import { routeCollector } from '@variance-authority/route-collector';

// Two pages, each read at two widths. A width is its own subject with its own
// baseline, because a page has one layout per breakpoint and a run that only
// reads the wide one is not watching the narrow one.
export default routeCollector({
  routes: {
    plans: 'http://localhost:5173/',
    seats: 'http://localhost:5173/seats',
  },
  widths: [375, 1280],
  roots: ['main'],
});
