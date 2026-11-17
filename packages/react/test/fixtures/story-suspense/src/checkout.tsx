import { Suspense, use } from 'react';

function CartSummary({ cart }: { cart: Promise<string> }) {
  return <p>{use(cart)}</p>;
}

export function CheckoutPage({ cart }: { cart: Promise<string> }) {
  return (
    <Suspense fallback={<p>loading</p>}>
      <CartSummary cart={cart} />
    </Suspense>
  );
}
