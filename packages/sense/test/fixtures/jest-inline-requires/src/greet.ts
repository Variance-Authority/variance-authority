import { withLogging } from './with-logging';

function greet(name: string): string {
  return `hi ${name}`;
}

export const loudGreet = withLogging(greet, 'greet');
export const evaluatedIn: string | undefined = expect.getState().currentTestName;
