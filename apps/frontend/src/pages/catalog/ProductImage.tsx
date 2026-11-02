// Miniatura de la imagen de un producto. La imagen exige el token, así que se descarga con la
// sesión y se muestra desde una URL local.
import ImageOutlined from '@mui/icons-material/ImageOutlined';
import { Avatar } from '@mui/material';
import { useEffect, useState } from 'react';

export function ProductImage({
  productId,
  name,
  version,
  load,
}: {
  productId: string;
  name: string;
  // Cambia cuando se carga una imagen nueva: se vuelve a descargar.
  version: number;
  // Null si el producto no tiene imagen. Tiene que ser estable.
  load: ((productId: string) => Promise<Blob>) | null;
}) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    if (load === null) return;
    let current = true;
    let created: string | null = null;
    load(productId).then(
      (blob) => {
        if (!current) return;
        created = URL.createObjectURL(blob);
        setUrl(created);
      },
      () => {
        // Sin imagen: queda el ícono.
      },
    );
    return () => {
      current = false;
      if (created !== null) URL.revokeObjectURL(created);
    };
  }, [load, productId, version]);

  return (
    <Avatar variant="rounded" alt={`Imagen de ${name}`} src={load ? (url ?? undefined) : undefined}>
      <ImageOutlined />
    </Avatar>
  );
}
