// The signup form: every field is checked on submit, and a clean form is posted.
const FIELDS = [
  { name: 'name', mandatory: true },
  { name: 'email', mandatory: true },
  { name: 'surname', mandatory: false },
  { name: 'phone', mandatory: false },
];

function show(name, error) {
  document.getElementById(`${name}-hint`).textContent = error;
}

function submit() {
  const values = Object.fromEntries(FIELDS.map((field) => [field.name, document.getElementById(field.name).value]));
  const errors = FIELDS.map((field) => validate(field.name, values[field.name], field.mandatory));
  FIELDS.forEach((field, k) => show(field.name, errors[k]));
  if (errors.some((error) => error !== '')) return;
  const user = userId();
  const id = post(values, user);
  track('submit', user);
  document.getElementById('status').textContent = `Saved #${id}`;
}

document.getElementById('send').addEventListener('click', submit);
