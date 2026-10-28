export function List({ items, empty }: { items: readonly string[]; empty: string }) {
  return (
    <ul>
      {items.length === 0 ? (
        <li>{empty}</li>
      ) : (
        items.map((item) => <li key={item}>{item.toUpperCase()}</li>)
      )}
    </ul>
  );
}
