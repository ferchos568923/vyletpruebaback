import { Router } from 'express';
import * as sucursalController from '../controllers/sucursal.controller.js';
import { authenticate, authenticateOpcional, requirePermiso, requireSucursalAcceso } from '../middlewares/auth.js';

const router = Router();

// Públicas
router.get('/sucursales/turisticas', sucursalController.listarTuristicas);
router.get('/sucursales/publicas', sucursalController.listarPublicas);
router.get('/empresas/:empresaId/sucursales', authenticateOpcional, sucursalController.listByEmpresa);
router.get('/sucursales/mias', authenticate, sucursalController.listMine);
router.get('/sucursales/:id', authenticateOpcional, sucursalController.getById);

// Protegidas
router.post('/empresas/:empresaId/sucursales', authenticate, requirePermiso('sucursales:crear'), sucursalController.create);
router.patch('/sucursales/:id', authenticate, requireSucursalAcceso('sucursales:editar'), sucursalController.update);
router.put('/sucursales/:id/servicios', authenticate, requireSucursalAcceso('sucursales:editar'), sucursalController.setServicios);
router.put('/sucursales/:id/imagenes', authenticate, requireSucursalAcceso('sucursales:editar'), sucursalController.setImagenes);
router.delete('/sucursales/:id', authenticate, requirePermiso('sucursales:eliminar'), sucursalController.remove);

export default router;