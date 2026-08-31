import { Router } from 'express';
import { authenticate } from '../middlewares/auth.js';
import * as estadisticasController from '../controllers/estadisticas.controller.js';
const router = Router();
router.get('/estadisticas/mias', authenticate, estadisticasController.misEstadisticas);
export default router;
