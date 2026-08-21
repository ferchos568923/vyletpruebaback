import { Router } from 'express';
import * as prod from '../controllers/producto.controller.js';
import { authenticate, requireSucursalAcceso } from '../middlewares/auth.js';

const router = Router();

router.get('/sucursales/:id/productos', prod.listPublic);
router.get('/sucursales/:id/productos/todos', authenticate, requireSucursalAcceso('sucursales:ver'), prod.adminList);
router.post('/sucursales/:id/productos', authenticate, requireSucursalAcceso('sucursales:editar'), prod.adminCreate);
router.patch('/sucursales/:id/productos/:productoId', authenticate, requireSucursalAcceso('sucursales:editar'), prod.adminUpdate);
router.delete('/sucursales/:id/productos/:productoId', authenticate, requireSucursalAcceso('sucursales:editar'), prod.adminRemove);

export default router;