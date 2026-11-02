// Carga datos de la API al montar la pantalla y cada vez que se pide recargar.
// El estado solo cambia cuando llega la respuesta, y una respuesta tardía de una carga
// anterior se descarta.
import { useCallback, useEffect, useState } from 'react';
import { errorMessage } from '../components/PageSection';

export interface Loaded<T> {
  data: T | null;
  error: string | null;
  reload: () => void;
}

// `fetcher` tiene que ser estable (useCallback): cuando cambia, se vuelve a cargar.
export function useLoader<T>(fetcher: () => Promise<T>, fallbackError: string): Loaded<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let current = true;
    fetcher().then(
      (value) => {
        if (!current) return;
        setData(value);
        setError(null);
      },
      (e: unknown) => {
        if (current) setError(errorMessage(e, fallbackError));
      },
    );
    return () => {
      current = false;
    };
  }, [fetcher, fallbackError, version]);

  const reload = useCallback(() => {
    setVersion((v) => v + 1);
  }, []);

  return { data, error, reload };
}
