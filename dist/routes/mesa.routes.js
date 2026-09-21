import { Router } from 'express';
import * as mesa from '../controllers/mesa.controller.js';
import { authenticate, requireSucursalAcceso } from '../middlewares/auth.js';
const router = Router();
// Público (restaurantes)
router.get('/sucursales/:id/mesas', mesa.listarMesas);
router.get('/sucursales/:id/mesas/disponibilidad', mesa.disponibilidadMesas);
router.get('/mesa/:token', mesa.resolverMesaPorToken);
// Gestión (dueño/staff/empleado de la sucursal)
router.post('/sucursales/:id/mesas', authenticate, requireSucursalAcceso('sucursales:editar'), mesa.crearMesa);
router.patch('/sucursales/:id/mesas/:mesaId', authenticate, requireSucursalAcceso('sucursales:editar'), mesa.editarMesa);
router.delete('/sucursales/:id/mesas/:mesaId', authenticate, requireSucursalAcceso('sucursales:editar'), mesa.eliminarMesa);
router.post('/sucursales/:id/mesas/:mesaId/regenerar-qr', authenticate, requireSucursalAcceso('sucursales:editar'), mesa.regenerarQRMesa);
export default router;
