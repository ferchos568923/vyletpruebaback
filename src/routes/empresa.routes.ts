import { Router } from 'express';
import * as empresaController from '../controllers/empresa.controller.js';
import * as planController from '../controllers/plan.controller.js';
import { authenticate, authenticateOpcional, requirePermiso } from '../middlewares/auth.js';

const router = Router();

// Públicas
router.get('/', empresaController.list);
router.get('/mias', authenticate, empresaController.listMine);
router.get('/:id', authenticateOpcional, empresaController.getById);

// Protegidas (requieren token + permiso)
router.post('/', authenticate, requirePermiso('empresas:crear'), empresaController.create);
router.patch('/:id', authenticate, requirePermiso('empresas:editar'), empresaController.update);
router.delete('/:id', authenticate, requirePermiso('empresas:eliminar'), empresaController.remove);

// Plan / suscripción de la empresa (dueño o staff que gestione la empresa)
router.get('/:id/plan', authenticate, planController.obtenerPlan);
router.post('/:id/plan', authenticate, planController.activarPlan);

export default router;