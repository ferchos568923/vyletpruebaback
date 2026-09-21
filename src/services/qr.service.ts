import jwt from 'jsonwebtoken';

const QR_SECRET = process.env.JWT_QR_SECRET || process.env.JWT_SECRET || 'vylet-qr-secret-change-in-production';
const QR_EXPIRY = '5m'; // 5 minutos

// --- Cupones ---
export interface QRCuponPayload {
  tipo: 'cupon';
  uid: number;
  cid: number;
  iat: number;
  exp: number;
}

export const generarQRToken = (usuarioId: number, cuponId: number): string => {
  return jwt.sign({ tipo: 'cupon', uid: usuarioId, cid: cuponId }, QR_SECRET, { expiresIn: QR_EXPIRY });
};

export const verificarQRToken = (token: string): QRCuponPayload | null => {
  try {
    const decoded = jwt.verify(token, QR_SECRET) as QRCuponPayload;
    if (decoded.tipo !== 'cupon') return null;
    return decoded;
  } catch {
    return null;
  }
};

// --- Reservas (mesa, habitación, visita) ---
export type TipoReserva = 'mesa' | 'habitacion' | 'visita';

export interface QRReservaPayload {
  tipo: 'reserva';
  uid: number;
  rid: number;       // reserva_id
  rtipo: TipoReserva; // mesa | habitacion | visita
  iat: number;
  exp: number;
}

export const generarQRReserva = (usuarioId: number, reservaId: number, tipoReserva: TipoReserva): string => {
  return jwt.sign({ tipo: 'reserva', uid: usuarioId, rid: reservaId, rtipo: tipoReserva }, QR_SECRET, { expiresIn: QR_EXPIRY });
};

export const verificarQRReserva = (token: string): QRReservaPayload | null => {
  try {
    const decoded = jwt.verify(token, QR_SECRET) as QRReservaPayload;
    if (decoded.tipo !== 'reserva') return null;
    return decoded;
  } catch {
    return null;
  }
};

// --- Cartilla de fidelización ---
export interface QRCartillaPayload {
  tipo: 'cartilla';
  uid: number;
  cid: number; // cartilla_cliente id
  iat: number;
  exp: number;
}

export const generarQRCartilla = (usuarioId: number, cartillaId: number): string => {
  return jwt.sign({ tipo: 'cartilla', uid: usuarioId, cid: cartillaId }, QR_SECRET, { expiresIn: QR_EXPIRY });
};

export const verificarQRCartilla = (token: string): QRCartillaPayload | null => {
  try {
    const decoded = jwt.verify(token, QR_SECRET) as QRCartillaPayload;
    if (decoded.tipo !== 'cartilla') return null;
    return decoded;
  } catch {
    return null;
  }
};

// --- Pedidos (menú en mesa) ---
export interface QRPedidoPayload {
  tipo: 'pedido';
  pid: number; // pedido id
  iat: number;
  exp: number;
}

export const generarQRPedido = (pedidoId: number): string => {
  return jwt.sign({ tipo: 'pedido', pid: pedidoId }, QR_SECRET, { expiresIn: QR_EXPIRY });
};

export const verificarQRPedido = (token: string): QRPedidoPayload | null => {
  try {
    const decoded = jwt.verify(token, QR_SECRET) as QRPedidoPayload;
    if (decoded.tipo !== 'pedido') return null;
    return decoded;
  } catch {
    return null;
  }
};
