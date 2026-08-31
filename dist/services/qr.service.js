import jwt from 'jsonwebtoken';
const QR_SECRET = process.env.JWT_QR_SECRET || process.env.JWT_SECRET || 'vylet-qr-secret-change-in-production';
const QR_EXPIRY = '5m'; // 5 minutos
export const generarQRToken = (usuarioId, cuponId) => {
    return jwt.sign({ tipo: 'cupon', uid: usuarioId, cid: cuponId }, QR_SECRET, { expiresIn: QR_EXPIRY });
};
export const verificarQRToken = (token) => {
    try {
        const decoded = jwt.verify(token, QR_SECRET);
        if (decoded.tipo !== 'cupon')
            return null;
        return decoded;
    }
    catch {
        return null;
    }
};
export const generarQRReserva = (usuarioId, reservaId, tipoReserva) => {
    return jwt.sign({ tipo: 'reserva', uid: usuarioId, rid: reservaId, rtipo: tipoReserva }, QR_SECRET, { expiresIn: QR_EXPIRY });
};
export const verificarQRReserva = (token) => {
    try {
        const decoded = jwt.verify(token, QR_SECRET);
        if (decoded.tipo !== 'reserva')
            return null;
        return decoded;
    }
    catch {
        return null;
    }
};
