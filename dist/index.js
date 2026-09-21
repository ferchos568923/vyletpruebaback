import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import http from 'http';
import routes from './routes/index.js';
import { authenticate } from './middlewares/auth.js';
import { initSocket } from './services/socket.service.js';
import { iniciarCronLimpieza } from './services/cron.service.js';
dotenv.config();
const app = express();
const PORT = process.env.PORT || 3000;
// Serializar BigInt (IDs de PostgreSQL) en las respuestas JSON
BigInt.prototype.toJSON = function () {
    return Number(this);
};
// Middlewares
app.use(cors());
app.use(express.json({ limit: '15mb' }));
app.use(express.urlencoded({ extended: true, limit: '15mb' }));
// Rutas
app.use('/api', routes);
// Ruta de prueba pública
app.get('/ping', (req, res) => {
    res.json({ message: 'pong', timestamp: new Date().toISOString() });
});
// Ruta protegida de prueba (requiere token)
app.get('/api/protected', authenticate, (req, res) => {
    const user = req.user;
    const { clave: _clave, ...userSafe } = user;
    res.json({ message: 'Acceso autorizado con token', user: userSafe });
});
// Crear servidor HTTP y WebSocket
const server = http.createServer(app);
initSocket(server);
iniciarCronLimpieza();
// Iniciar servidor
server.listen(PORT, () => {
    console.log(`🚀 Servidor corriendo en http://localhost:${PORT}`);
    console.log(`📡 Base de datos conectada con Prisma`);
    console.log(`🔐 Rutas de autenticación disponibles en /api/auth`);
    console.log(`🔌 WebSocket activo en ws://localhost:${PORT}`);
});
