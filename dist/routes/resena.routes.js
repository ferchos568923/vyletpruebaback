import { Router } from 'express';
import * as resenaController from '../controllers/resena.controller.js';
import { authenticate, authenticateOpcional, requirePermiso } from '../middlewares/auth.js';
const router = Router();
// Públicas / cliente
router.get('/sucursales/:id/resenas', authenticateOpcional, resenaController.listarPorSucursal);
router.post('/sucursales/:id/resenas', authenticate, resenaController.crear);
router.get('/sucursales/:id/resenas/mia', authenticate, resenaController.obtenerMia);
router.patch('/sucursales/:id/resenas/mia', authenticate, resenaController.actualizarMia);
router.delete('/sucursales/:id/resenas/mia', authenticate, resenaController.eliminarMia);
// Admin (moderación)
router.get('/admin/resenas', authenticate, requirePermiso('configuraciones:ver'), resenaController.listarAdmin);
router.delete('/admin/resenas/:id', authenticate, requirePermiso('configuraciones:editar'), resenaController.eliminarAdmin);
export default router;
