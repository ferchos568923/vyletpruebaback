import { Router } from 'express';
import * as notificacionController from '../controllers/notificacion.controller.js';
import { authenticate } from '../middlewares/auth.js';
const router = Router();
router.get('/notificaciones', authenticate, notificacionController.listarMias);
router.post('/notificaciones/leer-todas', authenticate, notificacionController.marcarTodasLeidas);
export default router;
