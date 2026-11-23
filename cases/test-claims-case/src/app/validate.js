// What a field's value is wrong with, or '' when nothing is.
function validate(name, value, mandatory) {
  if (mandatory && value === '') return 'required';
  if (name === 'email' && !value.includes('@')) return 'not an email';
  return '';
}

globalThis.validate = validate;
