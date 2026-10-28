document.querySelector('button').addEventListener('click', () => {
  const count = document.querySelector('output');
  count.textContent = String(Number(count.textContent) + 1);
});
