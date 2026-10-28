export const cls = <T>(_name: string, style: (props: T) => string): ((props: T) => string) => style;
