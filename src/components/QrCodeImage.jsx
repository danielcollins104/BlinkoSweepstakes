import React, { useEffect, useState } from 'react';
import QRCode from 'qrcode';

export default function QrCodeImage({ value, alt = 'Payment QR code', size = 180 }) {
  const [dataUrl, setDataUrl] = useState('');

  useEffect(() => {
    let active = true;
    if (!value) {
      setDataUrl('');
      return () => {
        active = false;
      };
    }
    QRCode.toDataURL(String(value), {
      width: size,
      margin: 1,
      color: { dark: '#0f172a', light: '#ffffff' },
    })
      .then((url) => {
        if (active) setDataUrl(url);
      })
      .catch(() => {
        if (active) setDataUrl('');
      });
    return () => {
      active = false;
    };
  }, [value, size]);

  if (!dataUrl) {
    return (
      <div
        className="qr-placeholder"
        style={{ width: size, height: size }}
        aria-label="Generating QR code"
      >
        Generating QR…
      </div>
    );
  }

  return (
    <img
      src={dataUrl}
      alt={alt}
      width={size}
      height={size}
      className="qr-image"
    />
  );
}
