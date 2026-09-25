const items = new URLSearchParams(location.search).get('items') ?? '';
const cart = await (await fetch(`/api/cart?items=${encodeURIComponent(items)}`)).json();
for (const key of ['subtotal', 'discount', 'total']) document.getElementById(key).textContent = cart[key];
