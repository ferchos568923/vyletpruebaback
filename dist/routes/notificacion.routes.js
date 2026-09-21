import { Router } from 'express';
import * as notificacionController from '../controllers/notificacion.controller.js';
import { authenticate } from '../middlewares/auth.js';
import { prisma } from '../services/prisma.js';
import { notificarUsuario } from '../services/socket.service.js';
const router = Router();
router.get('/notificaciones', authenticate, notificacionController.listarMias);
router.post('/notificaciones/leer-todas', authenticate, notificacionController.marcarTodasLeidas);
// POST /api/notificaciones/test — enviar notificación de prueba por WebSocket
router.post('/notificaciones/test', authenticate, async (req, res) => {
    try {
        const notif = await prisma.notificaciones.create({
            data: {
                usuario_id: req.user.id,
                tipo: 'qr_cupon',
                titulo: 'Cupón canjeado',
                mensaje: 'Tu cupón "2x1 en almuerzo" fue canjeado en Café Central',
                enlace: '/mis-cupones',
            }
        });
        notificarUsuario(req.user.id, { tipo: 'qr_cupon', notificacion: notif });
        res.json({ message: 'Notificación de prueba enviada', notificacion: notif });
    }
    catch (error) {
        console.error('Error enviando notificación de prueba:', error);
        res.status(500).json({ error: 'Error al enviar notificación de prueba' });
    }
});
export default router;
