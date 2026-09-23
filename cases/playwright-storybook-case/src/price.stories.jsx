import { Checkout, Price } from './Price.jsx';

export default { title: 'Case/Price' };

export const Plain = { render: () => <Price amount={5} /> };
export const Premium = { render: () => <Price amount={50} /> };
export const Pay = { render: () => <Checkout amount={500} /> };
