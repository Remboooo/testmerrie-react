import { Dispatch, SetStateAction, useEffect, useState } from 'react';

/**
 * useState whose value is initialised from and mirrored to localStorage.
 * `parse` converts the stored string back to T; values are written with String().
 */
export function usePersistedState<T>(
  key: string,
  initial: T,
  parse: (raw: string) => T,
): [T, Dispatch<SetStateAction<T>>] {
  const [value, setValue] = useState<T>(() => {
    const raw = localStorage.getItem(key);
    return raw === null ? initial : parse(raw);
  });

  useEffect(() => {
    localStorage.setItem(key, String(value));
  }, [key, value]);

  return [value, setValue];
}
