export function called(label, {
  required,
}) {
  return [label, required];
}

export const arrow = (label, {
  required,
}) => {
  return [label, required];
};

export function* generated(label, {
  required,
}) {
  yield [label, required];
}

export async function awaited(label, {
  required,
}) {
  return [label, required];
}

export class Constructed {
  constructor(label, {
    required,
  }) {
    this.required = [label, required];
  }
}
