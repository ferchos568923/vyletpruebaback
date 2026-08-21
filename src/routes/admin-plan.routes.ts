import { Router } from 'express';
import * as adminPlan from '../controllers/admin-plan.controller.js';
import { authenticate, requirePermiso } from '../middlewares/auth.js';

const router = Router();

router.get('/admin/planes', authenticate, requirePermiso('configuraciones:ver'), adminPlan.listPlanes);
router.post('/admin/planes', authenticate, requirePermiso('configuraciones:editar'), adminPlan.crearPlan);
router.patch('/admin/planes/:id', authenticate, requirePermiso('configuraciones:editar'), adminPlan.editarPlan);
router.delete('/admin/planes/:id', authenticate, requirePermiso('configuraciones:editar'), adminPlan.eliminarPlan);

router.get('/admin/suscripciones', authenticate, requirePermiso('configuraciones:ver'), adminPlan.listSuscripciones);
router.patch('/admin/suscripciones/:id', authenticate, requirePermiso('configuraciones:editar'), adminPlan.cambiarEstadoSuscripcion);

export default router;