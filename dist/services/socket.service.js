import { Server as SocketIOServer } from 'socket.io';
import { verifyToken } from './jwt.service.js';
let io;
export function initSocket(server) {
    io = new SocketIOServer(server, {
        cors: { origin: '*', methods: ['GET', 'POST'] },
        transports: ['polling', 'websocket'],
    });
    io.use((socket, next) => {
        const token = socket.handshake.auth.token || socket.handshake.query.token;
        if (!token)
            return next(new Error('No token'));
        const decoded = verifyToken(String(token));
        if (!decoded)
            return next(new Error('Token inválido'));
        socket.userId = decoded.userId;
        next();
    });
    io.on('connection', (socket) => {
        const userId = socket.userId;
        socket.join(`user_${userId}`);
        console.log(`🔌 WebSocket conectado: usuario ${userId}`);
        socket.on('disconnect', () => {
            console.log(`🔌 WebSocket desconectado: usuario ${userId}`);
        });
    });
    console.log('🔌 WebSocket server inicializado');
}
export function notificarUsuario(userId, data) {
    if (!io)
        return;
    io.to(`user_${userId}`).emit('notificacion', data);
}
export function notificarEmpresa(empresaId, data) {
    if (!io)
        return;
    io.to(`empresa_${empresaId}`).emit('notificacion', data);
}
export function enviarWhatsApp(telefono, mensaje) {
    console.log(`📱 WhatsApp a ${telefono}: ${mensaje}`);
}
