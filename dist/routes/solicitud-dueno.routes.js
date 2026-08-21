import { Router } from 'express';
import * as sd from '../controllers/solicitud-dueno.controller.js';
import { authenticate, requirePermiso } from '../middlewares/auth.js';
const router = Router();
router.get('/solicitud-dueno/mi', authenticate, sd.miEstado);
router.get('/admin/solicitudes-dueno', authenticate, requirePermiso('usuarios:editar'), sd.list);
router.post('/admin/solicitudes-dueno/:id/aprobar', authenticate, requirePermiso('usuarios:editar'), sd.aprobar);
router.post('/admin/solicitudes-dueno/:id/rechazar', authenticate, requirePermiso('usuarios:editar'), sd.rechazar);
export default router;
