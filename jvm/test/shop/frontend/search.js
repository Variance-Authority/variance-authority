const q = new URLSearchParams(location.search).get('q') ?? '';
document.querySelector('input[name=q]').value = q;
const results = q === '' ? [] : await (await fetch(`/api/search?q=${encodeURIComponent(q)}`)).json();
const list = document.getElementById('results');
for (const product of results) {
  const item = document.createElement('li');
  item.textContent = product.name;
  list.append(item);
}
list.dataset.ready = 'true';
