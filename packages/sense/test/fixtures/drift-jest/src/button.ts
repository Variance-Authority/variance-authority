import styles from './button.css';
import { add } from '@app/math';

export function label(count: number): string {
  return `${styles.primary}:${add(count, 1)}`;
}
