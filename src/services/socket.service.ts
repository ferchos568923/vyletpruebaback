import { Server as SocketIOServer } from 'socket.io';
import http from 'http';
import { verifyToken } from './jwt.service.js';

let io: SocketIOServer;

export function initSocket(server: http.Server) {
  io = new SocketIOServer(server, {
    cors: { origin: '*', methods: ['GET', 'POST'] },
    transports: ['polling', 'websocket'],
  });

  io.use((socket, next) => {
    const token = socket.handshake.auth.token || socket.handshake.query.token;
    if (!token) return next(new Error('No token'));
    const decoded = verifyToken(String(token));
    if (!decoded) return next(new Error('Token inválido'));
    (socket as any).userId = (decoded as any).userId;
    next();
  });

  io.on('connection', (socket) => {
    const userId = (socket as any).userId as number;
    socket.join(`user_${userId}`);
    console.log(`🔌 WebSocket conectado: usuario ${userId}`);
    socket.on('disconnect', () => {
      console.log(`🔌 WebSocket desconectado: usuario ${userId}`);
    });
  });

  console.log('🔌 WebSocket server inicializado');
}

export function notificarUsuario(userId: number, data: Record<string, unknown>) {
  if (!io) return;
  io.to(`user_${userId}`).emit('notificacion', data);
}

export function notificarEmpresa(empresaId: number, data: Record<string, unknown>) {
  if (!io) return;
  io.to(`empresa_${empresaId}`).emit('notificacion', data);
}

export function enviarWhatsApp(telefono: string, mensaje: string) {
  console.log(`📱 WhatsApp a ${telefono}: ${mensaje}`);
}
