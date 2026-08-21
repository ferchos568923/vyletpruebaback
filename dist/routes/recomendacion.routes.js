import { Router } from 'express';
import * as recomendacionController from '../controllers/recomendacion.controller.js';
import { authenticate, requirePermiso } from '../middlewares/auth.js';
const router = Router();
// Cliente
router.post('/recomendaciones/solicitudes', authenticate, recomendacionController.crearSolicitud);
router.get('/recomendaciones/mis-solicitudes', authenticate, recomendacionController.misSolicitudes);
// Staff
router.get('/admin/recomendaciones', authenticate, requirePermiso('configuraciones:ver'), recomendacionController.listarAdmin);
router.post('/admin/recomendaciones/:id/recomendar', authenticate, requirePermiso('configuraciones:editar'), recomendacionController.recomendar);
export default router;
